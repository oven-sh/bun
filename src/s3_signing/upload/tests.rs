use super::*;
use crate::MultiPartUploadOptions as Options;

const OPTIONS: Options = Options {
    queue_size: 1,
    part_size: 4,
    retry: 0,
};
const ERROR: S3Error<'static> = S3Error {
    code: b"E",
    message: b"m",
};
const CAN_COMMIT: bool = true;

fn with_queue(queue_size: u8) -> Upload {
    Upload::new(Options {
        queue_size,
        ..OPTIONS
    })
}

fn with_retries(retry: u8) -> Upload {
    Upload::new(Options { retry, ..OPTIONS })
}

fn with_part_size(part_size: u64) -> Upload {
    Upload::new(Options {
        part_size,
        ..OPTIONS
    })
}

fn write_in_chunks(upload: &mut Upload, bytes: &[u8], chunk: usize, encoded: bool) {
    for chunk in bytes.chunks(chunk) {
        match encoded {
            true => upload.write_encoded(chunk.len(), |out| out.extend_from_slice(chunk)),
            false => upload.write(chunk),
        };
    }
}

fn id() -> UploadId {
    UploadId::parse(b"id").unwrap()
}

fn failed_and_aborts() -> Step<'static> {
    Step::Failed(ERROR, Some(Request::Abort(id())))
}

fn ready(upload: &mut Upload) -> Vec<Request> {
    std::iter::from_fn(|| upload.next_request()).collect()
}

fn resent(step: Step<'_>) -> Request {
    match step {
        Step::Send(request) => request,
        step => panic!("{step:?}"),
    }
}

/// `bytes` are written and `Create` is answered. Returns the parts that went out.
fn sending(upload: &mut Upload, bytes: &[u8]) -> Vec<Request> {
    assert!(upload.write(bytes));
    assert_eq!(ready(upload), [Request::Create]);
    assert_eq!(upload.on_success(Request::Create, b"id"), Step::Drained(0));
    ready(upload)
}

fn committing(upload: &mut Upload) -> Request {
    let part = sending(upload, b"aaaa").remove(0);
    upload.end();
    assert_eq!(ready(upload), []);
    let _ = upload.on_success(part, b"e");
    ready(upload).remove(0)
}

#[test]
fn method_and_query() {
    let third_part = Part {
        index: 2,
        retries: 0,
        data: Vec::new(),
    };
    for (request, method, query) in [
        (Request::Put(Vec::new()), Method::PUT, None),
        (Request::Create, Method::POST, Some("?uploads=")),
        (
            Request::Part(id(), third_part),
            Method::PUT,
            Some("?partNumber=3&uploadId=id&x-id=UploadPart"),
        ),
        (
            Request::Commit(id(), Vec::new()),
            Method::POST,
            Some("?uploadId=id"),
        ),
        (Request::Abort(id()), Method::DELETE, Some("?uploadId=id")),
    ] {
        assert_eq!(request.method(), method);
        assert_eq!(request.query().as_deref(), query);
    }
}

#[test]
fn less_than_a_part_is_one_put() {
    for bytes in [&b""[..], b"abc"] {
        let mut upload = Upload::new(OPTIONS);
        assert!(!upload.write(bytes));
        assert_eq!(ready(&mut upload), []);
        upload.end();
        let mut requests = ready(&mut upload);
        assert_eq!(requests, [Request::Put(bytes.to_vec())]);
        assert!(upload.is_idle() && !upload.is_finished());
        assert_eq!(upload.on_success(requests.remove(0), b""), Step::Succeeded);
        assert_eq!(upload.accepted(), bytes.len() as u64);
    }
}

#[test]
fn parts_are_cut_at_the_part_size_however_the_bytes_come() {
    let bytes = b"aaaabbbbccccdd";
    for chunk in 1..=bytes.len() {
        for encoded in [false, true] {
            let mut upload = with_queue(64);
            write_in_chunks(&mut upload, bytes, chunk, encoded);
            upload.end();
            assert_eq!(ready(&mut upload), [Request::Create]);
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
    let mut upload = Upload::new(OPTIONS);
    assert!(!upload.write_encoded(1, |out| out.push(b'a')));
    assert!(upload.write_encoded(3, |out| out.extend_from_slice(b"aaa")));
    assert_eq!(ready(&mut upload), [Request::Create]);
}

#[test]
fn a_byte_after_a_part_does_not_allocate_a_part() {
    let mut upload = with_part_size(500);
    let _part = sending(&mut upload, &[0; 500]);
    assert_eq!(upload.memory_cost(), 0);
    upload.write(b"a");
    assert!(upload.memory_cost() < 100);
}

#[test]
fn a_part_allocates_no_more_than_the_part_size() {
    for chunk in [1, 64, 99, 300, 500, 501, 1500] {
        for encoded in [false, true] {
            let mut upload = with_part_size(500);
            write_in_chunks(&mut upload, &[0; 1500], chunk, encoded);
            let capacities: Vec<_> = upload.waiting.iter().map(Vec::capacity).collect();
            assert_eq!(capacities, [500; 3]);
        }
    }
}

#[test]
fn text_that_fits_the_allocation_does_not_grow_it() {
    let mut upload = with_part_size(500);
    write_in_chunks(&mut upload, &[0; 201], 200, false);
    assert_eq!(upload.memory_cost(), 400);
    upload.write_encoded(250, |out| out.extend_from_slice(&[0; 100]));
    assert_eq!(upload.memory_cost(), 400);
}

#[test]
fn queue_size_limits_what_is_in_flight() {
    let mut upload = with_queue(2);
    let mut parts = sending(&mut upload, b"aaaabbbbccccd");
    assert_eq!(parts.len(), 2);
    assert!(upload.has_backpressure());
    assert_eq!(upload.on_success(parts.remove(1), b"e"), Step::Drained(4));
    let third_part = Part {
        index: 2,
        retries: 0,
        data: b"cccc".to_vec(),
    };
    assert_eq!(ready(&mut upload), [Request::Part(id(), third_part)]);
    assert!(upload.has_backpressure());
    let _ = upload.on_success(parts.remove(0), b"e");
    assert_eq!(ready(&mut upload), []);
    assert!(!upload.has_backpressure() && !upload.is_idle());
}

#[test]
fn queue_size_is_at_most_64() {
    assert_eq!(sending(&mut with_queue(255), &[0; 400]).len(), 64);
}

#[test]
fn parts_that_wait_for_the_id_count_as_backpressure() {
    let mut upload = with_queue(2);
    upload.write(b"aaaa");
    let _ = ready(&mut upload);
    assert!(!upload.has_backpressure() && !upload.is_idle());
    upload.write(b"bbbb");
    assert_eq!(ready(&mut upload), []);
    assert!(upload.has_backpressure());
}

#[test]
fn commit_lists_the_etags_by_part_number() {
    let mut upload = with_queue(3);
    let mut parts = sending(&mut upload, b"aaaabbbbc");
    upload.end();
    parts.extend(ready(&mut upload));
    for (part, etag) in parts.into_iter().zip([b"x", b"y", b"z"]).rev() {
        assert_eq!(ready(&mut upload), []);
        let _ = upload.on_success(part, etag);
    }
    let body = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">",
        "<Part><PartNumber>1</PartNumber><ETag>x</ETag></Part>",
        "<Part><PartNumber>2</PartNumber><ETag>y</ETag></Part>",
        "<Part><PartNumber>3</PartNumber><ETag>z</ETag></Part>",
        "</CompleteMultipartUpload>",
    );
    assert_eq!(ready(&mut upload), [Request::Commit(id(), body.into())]);
}

#[test]
fn nothing_is_committed_before_end() {
    let mut upload = Upload::new(OPTIONS);
    let part = sending(&mut upload, b"aaaa").remove(0);
    let _ = upload.on_success(part, b"e");
    assert!(ready(&mut upload).is_empty() && upload.is_idle());
    upload.end();
    assert!(matches!(ready(&mut upload)[..], [Request::Commit(..)]));
}

#[test]
fn a_retry_sends_the_same_allocation() {
    let mut upload = with_retries(1);
    upload.write(b"abc");
    upload.end();
    let put = ready(&mut upload).remove(0);
    let body = put.body().as_ptr();
    let put = resent(upload.on_failure(put, ERROR, CAN_COMMIT));
    assert_eq!(put.body().as_ptr(), body);
    let out_of_retries = upload.on_failure(put, ERROR, CAN_COMMIT);
    assert_eq!(out_of_retries, Step::Failed(ERROR, None));
}

#[test]
fn each_part_has_its_own_retries() {
    let mut upload = Upload::new(Options {
        queue_size: 2,
        retry: 1,
        ..OPTIONS
    });
    let mut parts = sending(&mut upload, b"aaaabbbb");
    let second = resent(upload.on_failure(parts.remove(1), ERROR, CAN_COMMIT));
    let first = resent(upload.on_failure(parts.remove(0), ERROR, CAN_COMMIT));
    let out_of_retries = upload.on_failure(first, ERROR, CAN_COMMIT);
    assert_eq!(out_of_retries, failed_and_aborts());
    assert_eq!(upload.on_success(second, b"e"), Step::Nothing);
    let abort = resent(upload.on_failure(Request::Abort(id()), ERROR, CAN_COMMIT));
    assert_eq!(upload.on_failure(abort, ERROR, CAN_COMMIT), Step::Nothing);
}

#[test]
fn create_is_not_retried() {
    let mut upload = with_retries(3);
    upload.write(b"aaaa");
    let create = ready(&mut upload).remove(0);
    let step = upload.on_failure(create, ERROR, CAN_COMMIT);
    assert_eq!(step, Step::Failed(ERROR, None));
}

#[test]
fn commit_and_abort_share_their_retries() {
    let mut upload = with_retries(1);
    let commit = committing(&mut upload);
    let commit = resent(upload.on_failure(commit, ERROR, CAN_COMMIT));
    let out_of_retries = upload.on_failure(commit, ERROR, CAN_COMMIT);
    assert_eq!(out_of_retries, failed_and_aborts());
    let abort_failed = upload.on_failure(Request::Abort(id()), ERROR, CAN_COMMIT);
    assert_eq!(abort_failed, Step::Nothing);
}

#[test]
fn commit_is_not_retried_without_a_chance() {
    let mut upload = with_retries(1);
    let commit = committing(&mut upload);
    let step = upload.on_failure(commit, ERROR, !CAN_COMMIT);
    assert_eq!(step, failed_and_aborts());
    let abort_failed = upload.on_failure(Request::Abort(id()), ERROR, !CAN_COMMIT);
    assert_eq!(abort_failed, Step::Send(Request::Abort(id())));
}

#[test]
fn fail_waits_for_the_reply_to_commit() {
    let mut upload = Upload::new(OPTIONS);
    let commit = committing(&mut upload);
    assert_eq!(upload.fail(ERROR), Step::Nothing);
    assert_eq!(upload.on_success(commit, b""), Step::Succeeded);
    assert_eq!(upload.fail(ERROR), Step::Nothing);
}

#[test]
fn fail_drops_what_was_not_sent() {
    let mut upload = Upload::new(OPTIONS);
    let _part = sending(&mut upload, b"aaaabbbbc");
    assert_eq!(upload.fail(ERROR), failed_and_aborts());
    assert!(upload.is_ended() && upload.is_idle() && ready(&mut upload).is_empty());
    assert_eq!(upload.memory_cost(), 0);
}

#[test]
fn fail_ignores_the_reply_to_put() {
    let mut upload = with_retries(1);
    upload.end();
    let put = ready(&mut upload).remove(0);
    assert_eq!(upload.fail(ERROR), Step::Failed(ERROR, None));
    assert_eq!(upload.on_failure(put, ERROR, CAN_COMMIT), Step::Nothing);
}

#[test]
fn an_upload_created_after_fail_is_aborted() {
    for (reply, expected) in [
        (&b"id"[..], Step::Send(Request::Abort(id()))),
        (b"", Step::Nothing),
    ] {
        let mut upload = Upload::new(OPTIONS);
        upload.write(b"aaaa");
        let create = ready(&mut upload).remove(0);
        assert_eq!(upload.fail(ERROR), Step::Failed(ERROR, None));
        assert_eq!(upload.on_success(create, reply), expected);
    }
}

#[test]
fn an_upload_id_that_is_not_safe_in_a_query_fails_the_upload() {
    for reply in [
        &b""[..],
        b"a&b",
        b"a#b",
        b"a?b",
        b"a b",
        b"\xc3\xa9",
        &[b'x'; UploadId::MAX_LEN + 1],
    ] {
        let mut upload = Upload::new(OPTIONS);
        upload.write(b"aaaa");
        let create = ready(&mut upload).remove(0);
        let step = upload.on_success(create, reply);
        assert_eq!(step, Step::Failed(NO_UPLOAD_ID, None));
    }
    assert!(UploadId::parse(&[b'x'; UploadId::MAX_LEN]).is_some());
}
