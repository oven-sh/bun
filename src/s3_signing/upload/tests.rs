use super::*;

const ERROR: S3Error<'static> = S3Error {
    code: b"E",
    message: b"m",
};

fn upload(queue_size: u8, retry: u8) -> Upload {
    Upload::new(MultiPartUploadOptions {
        queue_size,
        part_size: 4,
        retry,
    })
}

fn show(request: &Request) -> String {
    let mut query = [0; 2048];
    let query = request.query(&mut query).unwrap_or_default();
    let (query, body) = (BStr::new(query), BStr::new(request.body()));
    format!("{:?} {query} {body}", request.method())
}

fn show_step(step: &Step<'_>) -> String {
    match step {
        Step::Nothing => "nothing".into(),
        Step::Send(request) => format!("send {}", show(request)),
        Step::Drained(bytes) => format!("drained {bytes}"),
        Step::Succeeded => "succeeded".into(),
        Step::Failed(error, abort) => {
            let abort = abort.as_ref().map(show).unwrap_or_default();
            format!("failed {} {abort}", BStr::new(error.message))
        }
    }
}

fn ready(upload: &mut Upload) -> Vec<Request> {
    std::iter::from_fn(|| upload.next_request()).collect()
}

fn shown(requests: &[Request]) -> Vec<String> {
    requests.iter().map(show).collect()
}

fn resent(step: Step<'_>) -> Request {
    match step {
        Step::Send(request) => request,
        step => panic!("{}", show_step(&step)),
    }
}

/// `bytes` are written and `Create` is answered. Returns the parts that went out.
fn sending(upload: &mut Upload, bytes: &[u8]) -> Vec<Request> {
    assert!(upload.write(bytes));
    assert_eq!(shown(&ready(upload)), ["POST ?uploads= "]);
    let created = upload.on_success(Request::Create, b"id");
    assert_eq!(show_step(&created), "drained 0");
    ready(upload)
}

fn committing(upload: &mut Upload) -> Request {
    let part = sending(upload, b"aaaa").remove(0);
    upload.end();
    assert!(ready(upload).is_empty());
    let _ = upload.on_success(part, b"e");
    ready(upload).remove(0)
}

#[test]
fn less_than_a_part_is_one_put() {
    for bytes in [&b""[..], b"abc"] {
        let mut upload = upload(2, 0);
        assert!(!upload.write(bytes));
        assert!(ready(&mut upload).is_empty());
        upload.end();
        let mut requests = ready(&mut upload);
        assert_eq!(shown(&requests), [format!("PUT  {}", BStr::new(bytes))]);
        assert!(upload.is_idle() && !upload.is_finished());
        let step = upload.on_success(requests.remove(0), b"");
        assert_eq!(show_step(&step), "succeeded");
        assert_eq!(upload.accepted(), bytes.len() as u64);
    }
}

#[test]
fn parts_are_cut_at_the_part_size_however_the_bytes_come() {
    let bytes = b"aaaabbbbccccdd";
    for chunk in 1..=bytes.len() {
        for encoded in [false, true] {
            let mut upload = upload(64, 0);
            for chunk in bytes.chunks(chunk) {
                match encoded {
                    true => upload.write_encoded(chunk.len(), |out| out.extend_from_slice(chunk)),
                    false => upload.write(chunk),
                };
            }
            upload.end();
            assert_eq!(shown(&ready(&mut upload)), ["POST ?uploads= "]);
            let _ = upload.on_success(Request::Create, b"id");
            let parts = ready(&mut upload);
            let bodies: Vec<_> = parts.iter().map(Request::body).collect();
            assert_eq!(bodies, [&b"aaaa"[..], b"bbbb", b"cccc", b"dd"]);
            assert_eq!(upload.accepted(), 14);
        }
    }
}

#[test]
fn text_that_fills_the_part_exactly_starts_the_upload() {
    let mut upload = upload(2, 0);
    assert!(!upload.write_encoded(1, |out| out.push(b'a')));
    assert!(upload.write_encoded(3, |out| out.extend_from_slice(b"aaa")));
    assert_eq!(shown(&ready(&mut upload)), ["POST ?uploads= "]);
}

#[test]
fn a_part_after_the_first_is_allocated_once() {
    let mut upload = upload(2, 0);
    assert_eq!(upload.memory_cost(), 0);
    upload.write(b"aaaab");
    let tail = upload.tail.as_ptr();
    upload.write(b"bbb");
    assert_eq!(upload.waiting[1].as_ptr(), tail);
    assert_eq!(upload.tail.capacity(), 0);
}

#[test]
fn queue_size_limits_what_is_in_flight() {
    let mut upload = upload(2, 0);
    let mut parts = sending(&mut upload, b"aaaabbbbccccd");
    assert_eq!(parts.len(), 2);
    assert!(upload.has_backpressure());
    let step = upload.on_success(parts.remove(1), b"e");
    assert_eq!(show_step(&step), "drained 4");
    let third = ready(&mut upload);
    let expected = "PUT ?partNumber=3&uploadId=id&x-id=UploadPart cccc";
    assert_eq!(shown(&third), [expected]);
    assert!(upload.has_backpressure());
    let _ = upload.on_success(parts.remove(0), b"e");
    assert!(ready(&mut upload).is_empty());
    assert!(!upload.has_backpressure() && !upload.is_idle());
}

#[test]
fn queue_size_is_at_most_64() {
    assert_eq!(sending(&mut upload(255, 0), &[0; 400]).len(), 64);
}

#[test]
fn parts_that_wait_for_the_id_count_as_backpressure() {
    let mut upload = upload(2, 0);
    upload.write(b"aaaa");
    let _ = ready(&mut upload);
    assert!(!upload.has_backpressure() && !upload.is_idle());
    upload.write(b"bbbb");
    assert!(ready(&mut upload).is_empty());
    assert!(upload.has_backpressure());
}

#[test]
fn commit_lists_the_etags_by_part_number() {
    let mut upload = upload(3, 0);
    let mut parts = sending(&mut upload, b"aaaabbbbc");
    upload.end();
    parts.extend(ready(&mut upload));
    for (part, etag) in parts.into_iter().zip([b"1", b"2", b"3"]).rev() {
        assert!(ready(&mut upload).is_empty());
        let _ = upload.on_success(part, etag);
    }
    let expected = concat!(
        "POST ?uploadId=id <?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">",
        "<Part><PartNumber>1</PartNumber><ETag>1</ETag></Part>",
        "<Part><PartNumber>2</PartNumber><ETag>2</ETag></Part>",
        "<Part><PartNumber>3</PartNumber><ETag>3</ETag></Part>",
        "</CompleteMultipartUpload>",
    );
    assert_eq!(shown(&ready(&mut upload)), [expected]);
}

#[test]
fn nothing_is_committed_before_end() {
    let mut upload = upload(1, 0);
    let part = sending(&mut upload, b"aaaa").remove(0);
    let _ = upload.on_success(part, b"e");
    assert!(ready(&mut upload).is_empty() && upload.is_idle());
    upload.end();
    assert!(matches!(ready(&mut upload)[..], [Request::Commit(..)]));
}

#[test]
fn a_retry_sends_the_same_allocation() {
    let mut upload = upload(1, 1);
    upload.write(b"abc");
    upload.end();
    let put = ready(&mut upload).remove(0);
    let body = put.body().as_ptr();
    let put = resent(upload.on_failure(put, ERROR, true));
    assert_eq!(put.body().as_ptr(), body);
    assert_eq!(show_step(&upload.on_failure(put, ERROR, true)), "failed m ");
}

#[test]
fn each_part_has_its_own_retries() {
    let mut upload = upload(2, 1);
    let mut parts = sending(&mut upload, b"aaaabbbb");
    let second = resent(upload.on_failure(parts.remove(1), ERROR, true));
    let first = resent(upload.on_failure(parts.remove(0), ERROR, true));
    let failed = upload.on_failure(first, ERROR, true);
    assert_eq!(show_step(&failed), "failed m DELETE ?uploadId=id ");
    assert_eq!(show_step(&upload.on_success(second, b"e")), "nothing");
    let Step::Failed(_, Some(abort)) = failed else {
        unreachable!()
    };
    let abort = resent(upload.on_failure(abort, ERROR, true));
    assert_eq!(show_step(&upload.on_failure(abort, ERROR, true)), "nothing");
}

#[test]
fn create_is_not_retried() {
    let mut upload = upload(1, 3);
    upload.write(b"aaaa");
    let create = ready(&mut upload).remove(0);
    let step = upload.on_failure(create, ERROR, true);
    assert_eq!(show_step(&step), "failed m ");
}

#[test]
fn commit_and_abort_share_their_retries() {
    let mut upload = upload(1, 1);
    let commit = committing(&mut upload);
    let commit = resent(upload.on_failure(commit, ERROR, true));
    let Step::Failed(_, Some(abort)) = upload.on_failure(commit, ERROR, true) else {
        panic!("no abort")
    };
    assert_eq!(show_step(&upload.on_failure(abort, ERROR, true)), "nothing");
}

#[test]
fn commit_is_not_retried_without_a_chance() {
    let mut upload = upload(1, 1);
    let commit = committing(&mut upload);
    let Step::Failed(_, Some(abort)) = upload.on_failure(commit, ERROR, false) else {
        panic!("no abort")
    };
    resent(upload.on_failure(abort, ERROR, false));
}

#[test]
fn fail_waits_for_the_reply_to_commit() {
    let mut upload = upload(1, 0);
    let commit = committing(&mut upload);
    assert_eq!(show_step(&upload.fail(ERROR)), "nothing");
    assert_eq!(show_step(&upload.on_success(commit, b"")), "succeeded");
    assert_eq!(show_step(&upload.fail(ERROR)), "nothing");
}

#[test]
fn fail_drops_what_was_not_sent() {
    let mut upload = upload(1, 0);
    let _part = sending(&mut upload, b"aaaabbbbc");
    let step = upload.fail(ERROR);
    assert_eq!(show_step(&step), "failed m DELETE ?uploadId=id ");
    assert!(upload.is_ended() && upload.is_idle() && ready(&mut upload).is_empty());
    assert_eq!(upload.memory_cost(), 0);
}

#[test]
fn fail_ignores_the_reply_to_put() {
    let mut upload = upload(1, 1);
    upload.end();
    let put = ready(&mut upload).remove(0);
    assert_eq!(show_step(&upload.fail(ERROR)), "failed m ");
    assert_eq!(show_step(&upload.on_failure(put, ERROR, true)), "nothing");
}

#[test]
fn an_upload_created_after_fail_is_aborted() {
    for (id, expected) in [(&b"id"[..], "send DELETE ?uploadId=id "), (b"", "nothing")] {
        let mut upload = upload(1, 0);
        upload.write(b"aaaa");
        let create = ready(&mut upload).remove(0);
        assert_eq!(show_step(&upload.fail(ERROR)), "failed m ");
        assert_eq!(show_step(&upload.on_success(create, id)), expected);
    }
}

#[test]
fn upload_ids() {
    for id in [
        &b""[..],
        b"a&b",
        b"a#b",
        b"a?b",
        b"a b",
        b"\xc3\xa9",
        &[b'x'; 2001],
    ] {
        let mut upload = upload(1, 0);
        upload.write(b"aaaa");
        let create = ready(&mut upload).remove(0);
        let step = upload.on_success(create, id);
        let expected = "failed Failed to initiate multipart upload ";
        assert_eq!(show_step(&step), expected);
    }
    let part = Part {
        number: u32::MAX,
        retries: 0,
        data: Vec::new(),
    };
    let longest = UploadId::parse(&[b'x'; 2000]).unwrap();
    assert!(Request::Part(longest, part).query(&mut [0; 2048]).is_some());
}
