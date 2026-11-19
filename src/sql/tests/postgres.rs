use std::rc::Rc;

use bun_ptr::RefPtr;
use bun_sql::postgres::AnyPostgresError as Error;
use bun_sql::postgres::handshake::{ChannelBinding, ConnectionStrings, Handshake, Phase};
use bun_sql::postgres::pipeline::{
    self, Cached, ErrorKind, MAX_PIPELINE_SIZE, OnCancel, OnError, Protocol, Step,
};
use bun_sql::shared::SSLMode;

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

/// Stand-ins for C that leave their output as it is, all zeros. postgres-auth.test.ts covers the real ones.
macro_rules! returns {
    ($($value:literal: $($name:ident)*;)*) => {
        $($(#[unsafe(no_mangle)]
        extern "C" fn $name() -> usize {
            $value
        })*)*
    };
}

returns! {
    0: ERR_clear_error CRYPTO_library_init ERR_load_BIO_strings OpenSSL_add_all_algorithms
        SSL_load_error_strings SSL_get_peer_cert_chain sk_value OBJ_find_sigid_algs OBJ_obj2nid
        X509_ALGOR_get0 X509_digest X509_get0_signature X509_get_signature_nid RSA_PSS_PARAMS_free
        d2i_RSA_PSS_PARAMS EVP_get_digestbynid EVP_blake2b256 EVP_blake2b512 EVP_md4 EVP_ripemd160
        EVP_sha1 EVP_sha224 EVP_sha384 EVP_sha3_224 EVP_sha3_256 EVP_sha3_384 EVP_sha3_512
        EVP_sha512 EVP_sha512_224 EVP_sha512_256 mi_free mi_malloc mi_realloc mi_usable_size
        highway_memmem;
    1: SSL_library_init EVP_sha256 EVP_md5 EVP_Digest EVP_DigestInit EVP_DigestUpdate
        EVP_DigestFinal EVP_MD_CTX_cleanup RAND_bytes PKCS5_PBKDF2_HMAC;
}

#[unsafe(no_mangle)]
unsafe extern "C" fn HMAC(
    _: usize,
    _: usize,
    _: usize,
    _: usize,
    _: usize,
    out: *mut u8,
    len: &mut u32,
) -> *mut u8 {
    *len = 32;
    out
}

#[unsafe(no_mangle)]
unsafe extern "C" fn CRYPTO_memcmp(a: *const u8, b: *const u8, len: usize) -> i32 {
    // SAFETY: the caller passes two slices of that length.
    unsafe { (std::slice::from_raw_parts(a, len) != std::slice::from_raw_parts(b, len)) as i32 }
}

#[unsafe(no_mangle)]
extern "C" fn simdutf__base64_length_from_binary(len: usize, _: i32) -> usize {
    len
}

/// One `A` per byte.
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__base64_encode(_: usize, len: usize, out: *mut u8, _: i32) -> usize {
    // SAFETY: `out` has room for `simdutf__base64_length_from_binary(len)` bytes.
    unsafe { out.write_bytes(b'A', len) };
    len
}

#[repr(C)]
struct Decoded(i32, usize);

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__base64_decode_from_binary(
    _: usize,
    _: usize,
    out: *mut u8,
    room: usize,
    _: i32,
) -> Decoded {
    // SAFETY: `out` has room for `room` bytes.
    unsafe { out.write_bytes(0, room) };
    Decoded(0, room)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(text: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { std::slice::from_raw_parts(text, len) };
    text.iter().take_while(|&&byte| byte != needle).count()
}

mod handshake {
    use super::*;
    use ChannelBinding::{Disable, Prefer, Require};

    const OK: &[u8] = b"\0\0\0\0";
    const CLEARTEXT: &[u8] = b"\0\0\0\x03";
    const MD5: &[u8] = b"\0\0\0\x05salt";
    const SASL: &[u8] = b"\0\0\0\x0aSCRAM-SHA-256\0\0";
    const SASL_PLUS: &[u8] = b"\0\0\0\x0aSCRAM-SHA-256-PLUS\0SCRAM-SHA-256\0\0";
    const CONTINUE: &[u8] = b"\0\0\0\x0br=AAAAAAAAAAAAAAAAAAserver,s=c2FsdA==,i=4096";
    const FINAL: &[u8] = b"\0\0\0\x0cv=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const ALL: [&[u8]; 6] = [OK, CLEARTEXT, MD5, SASL, CONTINUE, FINAL];

    fn dialing(mode: SSLMode, binding: ChannelBinding) -> Handshake {
        let strings = ConnectionStrings::new(b"u", b"pw", b"pw", b"db", b"", b"");
        Handshake::new(strings, mode, binding)
    }

    /// What the last of `requests` is refused with, and whether it is answered.
    fn login(
        mode: SSLMode,
        binding: ChannelBinding,
        requests: &[&[u8]],
    ) -> (Handshake, Result<bool, Error>) {
        let mut handshake = dialing(mode, binding);
        if mode != SSLMode::Disable {
            handshake.request_tls(<[u8]>::len);
        }
        handshake.send_startup(&mut Vec::new()).unwrap();
        let mut last = Ok(false);
        for request in requests {
            assert!(last.is_ok());
            let mut out = Vec::new();
            last = handshake
                .authenticate(request, None, &mut out)
                .map_err(|refusal| refusal.error);
            assert_eq!(last == Ok(true), !out.is_empty());
        }
        (handshake, last)
    }

    #[test]
    fn each_request_is_taken_in_its_turn_only() {
        let accepted: [(&[&[u8]], &[&[u8]]); 7] = [
            (&[], &[OK, CLEARTEXT, MD5, SASL]),
            (&[CLEARTEXT], &[OK]),
            (&[MD5], &[OK]),
            (&[SASL], &[CONTINUE]),
            (&[SASL, CONTINUE], &[FINAL]),
            (&[SASL, CONTINUE, FINAL], &[OK]),
            (&[OK], &[OK]),
        ];
        for (before, accepted) in accepted {
            for next in ALL {
                let (mut handshake, result) =
                    login(SSLMode::Disable, Prefer, &[before, &[next]].concat());
                let refused = (!accepted.contains(&next)).then_some(Error::UnexpectedMessage);
                assert_eq!(result.err(), refused, "{before:?} {next:?}");
                let logged_in = before == [OK] || (next == OK && refused.is_none());
                assert_eq!(handshake.on_ready_for_query().is_ok(), logged_in);
            }
        }
    }

    #[test]
    fn a_bad_server_first_message_is_refused() {
        let server_first = |text: &str| [b"\0\0\0\x0b", text.as_bytes()].concat();
        let nonce = "r=AAAAAAAAAAAAAAAAAAserver";
        for (text, error) in [
            ("r=other,s=c2FsdA==,i=4096".into(), Error::InvalidMessage),
            (format!("{nonce},i=4096"), Error::InvalidMessage),
            (format!("m=,{nonce},s=AAAA,i=4096"), Error::InvalidMessage),
            (format!("{nonce},s=AAAA,i=x"), Error::InvalidCharacter),
            (
                format!("{nonce},s=AAAA,i=4095"),
                Error::SASLIterationCountOutOfRange,
            ),
            (
                format!("{nonce},s=AAAA,i=10000001"),
                Error::SASLIterationCountOutOfRange,
            ),
            (
                format!("{nonce},s={},i=4096", "A".repeat(2044)),
                Error::InvalidMessage,
            ),
        ] {
            let (handshake, result) =
                login(SSLMode::Disable, Prefer, &[SASL, &server_first(&text)]);
            assert_eq!(result, Err(error), "{text}");
            assert!(handshake.in_sasl());
        }
    }

    #[test]
    fn a_short_signature_is_a_mismatch() {
        for signature in [&FINAL[..5], &FINAL[..6], &FINAL[..FINAL.len() - 1]] {
            let (_, result) = login(SSLMode::Disable, Prefer, &[SASL, CONTINUE, signature]);
            assert_eq!(result, Err(Error::SASL_SIGNATURE_MISMATCH));
        }
    }

    #[test]
    fn required_binding_refuses_every_method_without_tls() {
        for request in [OK, CLEARTEXT, MD5, SASL, SASL_PLUS] {
            let (_, result) = login(SSLMode::Disable, Require, &[request]);
            assert_eq!(result, Err(Error::ChannelBindingRequired));
        }
    }

    #[test]
    fn plus_without_tls_is_refused_where_tls_was_asked_for() {
        for (mode, binding, result) in [
            (SSLMode::Prefer, Prefer, Err(Error::ChannelBindingFailed)),
            (SSLMode::Prefer, Disable, Ok(true)),
            (SSLMode::Disable, Prefer, Ok(true)),
        ] {
            assert_eq!(login(mode, binding, &[SASL_PLUS]).1, result);
        }
    }

    #[test]
    fn a_request_of_the_wrong_length_is_refused() {
        for request in [&OK[..3], b"\0\0\0\0x", &MD5[..7], &SASL[..4], &FINAL[..4]] {
            let (_, result) = login(SSLMode::Disable, Prefer, &[request]);
            assert_eq!(result, Err(Error::InvalidMessageLength));
        }
    }

    #[test]
    fn nothing_is_answered_before_the_startup_message() {
        let mut handshake = dialing(SSLMode::VerifyFull, Prefer);
        let mut sent = Vec::new();
        for room in [3, 0, 5, 8] {
            handshake.request_tls(|rest| {
                sent.extend_from_slice(&rest[..room]);
                room
            });
        }
        assert_eq!(sent, [0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
        assert!(matches!(handshake.on_ssl_reply(b'S'), Ok(true)));
        for request in ALL {
            let mut out = Vec::new();
            assert!(handshake.authenticate(request, None, &mut out).is_err());
            assert!(out.is_empty());
        }
        assert!(handshake.on_ready_for_query().is_err());
        assert!(matches!(handshake.phase(), Phase::TlsHandshake));
    }

    #[test]
    fn only_prefer_goes_on_without_tls() {
        use SSLMode::*;
        for mode in [Prefer, Require, VerifyCa, VerifyFull] {
            let mut handshake = dialing(mode, ChannelBinding::Prefer);
            let mut out = Vec::new();
            handshake.send_startup(&mut out).unwrap();
            handshake.send_cancel(&[0; 16], &mut out);
            assert!(out.is_empty());
            handshake.request_tls(<[u8]>::len);
            let reply = handshake.on_ssl_reply(b'N').map_err(|it| it.error);
            let refused = (mode != Prefer).then_some(Error::TLSNotAvailable);
            assert_eq!(reply.err(), refused);
            let reply = handshake.on_ssl_reply(b'E').map_err(|it| it.error);
            assert_eq!(reply, Err(Error::UnexpectedMessage));
            handshake.send_startup(&mut out).unwrap();
            handshake.send_cancel(&[0; 16], &mut out);
            assert_eq!(out.is_empty(), mode != Prefer);
        }
    }

    #[test]
    fn ready_is_announced_once_and_closed_is_final() {
        let (mut handshake, _) = login(SSLMode::Disable, Prefer, &[OK]);
        assert!(!handshake.announce());
        assert_eq!(handshake.on_ready_for_query(), Ok(true));
        assert_eq!(handshake.on_ready_for_query(), Ok(false));
        assert_eq!([handshake.announce(), handshake.announce()], [true, false]);

        let (mut handshake, _) = login(SSLMode::Disable, Prefer, &[SASL]);
        handshake.close();
        let mut out = Vec::new();
        handshake.request_tls(|_| unreachable!());
        handshake.send_startup(&mut out).unwrap();
        handshake.send_cancel(&[0; 16], &mut out);
        assert!(out.is_empty() && handshake.on_ssl_reply(b'S').is_err());
        assert!(handshake.on_ready_for_query().is_err());
        assert!(matches!(handshake.phase(), Phase::Closed { in_sasl: true }));
    }
}

mod requests {
    use super::*;
    use ErrorKind::{Canceled, Other, StaleStatement};
    use Read::*;
    use Wrote::*;
    use core::cell::Cell;

    type Statement = RefPtr<pipeline::Statement<(), ()>>;
    type Pipeline = pipeline::Pipeline<Rc<Request>, (), ()>;

    #[derive(Clone, Copy, Debug)]
    enum Read {
        ParseComplete,
        Parameters,
        Columns,
        NoData,
        BindComplete,
        CommandComplete,
    }

    #[derive(Debug, PartialEq)]
    enum Wrote {
        Query,
        Bind,
        Parse,
        ParseBind,
        CloseParse,
        CloseParseBind,
        /// It is rejected in the place of being written.
        Never,
    }

    struct Request(char, Cell<u64>);

    impl pipeline::Request for Request {
        fn turn(&self) -> &Cell<u64> {
            &self.1
        }
    }

    const DESCRIBED: &[Read] = &[ParseComplete, Parameters, Columns];
    const EXECUTED: &[Read] = &[BindComplete, CommandComplete];

    fn named(parameters: usize) -> Statement {
        pipeline::Statement::new(Some(0), vec![0; parameters].into(), ())
    }

    fn push(pipeline: &mut Pipeline, name: char, statement: &Statement) -> Rc<Request> {
        let request = Rc::new(Request(name, Cell::new(0)));
        let protocol = Protocol::Extended {
            describe_first: !statement.declared.is_empty(),
        };
        pipeline.push(Rc::clone(&request), statement.clone(), protocol);
        request
    }

    fn push_simple(pipeline: &mut Pipeline, name: char) -> Rc<Request> {
        let request = Rc::new(Request(name, Cell::new(0)));
        let statement = pipeline::Statement::new(None, Box::default(), ());
        pipeline.push(Rc::clone(&request), statement, Protocol::Simple);
        request
    }

    fn advance(pipeline: &mut Pipeline) -> Vec<(char, Wrote)> {
        let mut wire = Vec::new();
        while let Some((next, step)) = pipeline.next(0) {
            let request = Rc::clone(&next.request);
            let wrote = match step {
                None => Never,
                Some(Step::Query) => Query,
                Some(Step::Bind) => Bind,
                Some(Step::Parse { close, bind }) => match (close, bind) {
                    (false, false) => Parse,
                    (false, true) => ParseBind,
                    (true, false) => CloseParse,
                    (true, true) => CloseParseBind,
                },
            };
            wire.push((request.0, wrote));
            match step {
                Some(step) => assert!(pipeline.wrote(&request, step)),
                None => assert!(pipeline.unqueue(&request).is_some()),
            }
        }
        wire
    }

    fn read(pipeline: &mut Pipeline, messages: &[Read]) {
        for message in messages {
            match message {
                ParseComplete => pipeline.on_parse_complete(),
                Parameters => pipeline.on_parameter_description([25].into()),
                Columns => pipeline.on_row_description(),
                NoData | BindComplete => pipeline.on_bind_complete(),
                CommandComplete => pipeline.on_result(),
            }
            .unwrap();
        }
    }

    /// The request that a ReadyForQuery ends.
    fn ready(pipeline: &mut Pipeline) -> Option<char> {
        pipeline.on_ready_for_query(b'I').map(|it| it.request.0)
    }

    fn error(pipeline: &mut Pipeline, kind: ErrorKind) -> OnError {
        pipeline.on_error(kind, (), |_| named(0)).unwrap().1
    }

    fn prepared(pipelining: bool) -> (Pipeline, Statement) {
        let (mut pipeline, statement) = (Pipeline::new(pipelining), named(0));
        push(&mut pipeline, '_', &statement);
        advance(&mut pipeline);
        read(&mut pipeline, &[DESCRIBED, EXECUTED].concat());
        ready(&mut pipeline);
        (pipeline, statement)
    }

    #[test]
    fn what_is_written_behind_what() {
        let (pipeline, statement) = (&mut Pipeline::new(true), named(1));
        push(pipeline, 'a', &statement);
        push(pipeline, 'b', &statement);
        push_simple(pipeline, 'c');
        push(pipeline, 'd', &statement);

        assert_eq!(advance(pipeline), [('a', Parse)]);
        assert!(pipeline.executed().is_err());
        read(pipeline, DESCRIBED);
        assert_eq!(advance(pipeline), []);
        assert_eq!(ready(pipeline), None);
        assert_eq!(advance(pipeline), [('a', Bind), ('b', Bind)]);

        read(pipeline, EXECUTED);
        assert_eq!(ready(pipeline), Some('a'));
        assert_eq!(advance(pipeline), []);
        read(pipeline, EXECUTED);
        assert_eq!(ready(pipeline), Some('b'));
        assert_eq!(advance(pipeline), [('c', Query)]);

        read(pipeline, &[Columns, CommandComplete]);
        assert_eq!(advance(pipeline), []);
        assert_eq!(ready(pipeline), Some('c'));
        assert_eq!(advance(pipeline), [('d', Bind)]);

        assert_eq!(ready(pipeline), None, "it answers nothing");
        read(pipeline, EXECUTED);
        assert_eq!(ready(pipeline), Some('d'));
        assert!(!pipeline.is_busy());
    }

    #[test]
    fn a_bind_waits_without_pipelining_or_without_room() {
        let (mut pipeline, statement) = prepared(false);
        push(&mut pipeline, 'a', &statement);
        push(&mut pipeline, 'b', &statement);
        assert_eq!(advance(&mut pipeline), [('a', Bind)]);

        let (mut pipeline, statement) = prepared(true);
        push(&mut pipeline, 'a', &statement);
        advance(&mut pipeline);
        push(&mut pipeline, 'b', &statement);
        assert!(pipeline.next(MAX_PIPELINE_SIZE).is_none());
    }

    /// What the cache does with `statement`, and what the next request that runs it writes.
    fn after_error(statement: &Statement, before: &[Read], kind: ErrorKind) -> (Cached, Wrote) {
        let pipeline = &mut Pipeline::new(true);
        push(pipeline, 'a', statement);
        advance(pipeline);
        read(pipeline, before);
        let OnError::Fail { keep_error, cached } = error(pipeline, kind) else {
            panic!("retried");
        };
        assert!(keep_error && pipeline.in_transaction());
        push(pipeline, 'b', statement);
        assert_eq!(ready(pipeline), Some('a'));
        (cached, advance(pipeline).remove(0).1)
    }

    #[test]
    fn what_an_error_makes_of_a_statement_without_parameters() {
        use Cached::{Close, Forget, Keep};
        for (before, kind, expected) in [
            (&[][..], Canceled, (Keep, ParseBind)),
            (&[], Other, (Forget, Never)),
            (&[ParseComplete], Canceled, (Keep, CloseParseBind)),
            (&[ParseComplete, Parameters], Other, (Close, Never)),
            (&[ParseComplete, Parameters, Columns], Other, (Keep, Bind)),
            (&[ParseComplete, Parameters, NoData], Canceled, (Keep, Bind)),
        ] {
            assert_eq!(after_error(&named(0), before, kind), expected, "{before:?}");
        }
    }

    #[test]
    fn what_an_error_makes_of_a_statement_with_a_parameter() {
        use Cached::{Close, Keep};
        for (before, kind, expected) in [
            (&[][..], Canceled, (Keep, Parse)),
            (&[ParseComplete], Canceled, (Keep, CloseParse)),
            (&[ParseComplete], Other, (Close, Never)),
            (&[ParseComplete, Parameters], Canceled, (Keep, CloseParse)),
            (
                &[ParseComplete, Parameters, Columns],
                Canceled,
                (Keep, Bind),
            ),
        ] {
            assert_eq!(after_error(&named(1), before, kind), expected, "{before:?}");
        }
    }

    #[test]
    fn a_stale_statement_is_retried_once() {
        let (mut pipeline, statement) = prepared(true);
        push(&mut pipeline, 'a', &statement);
        advance(&mut pipeline);
        let outcome = error(&mut pipeline, StaleStatement);
        assert!(matches!(outcome, OnError::Retry { cancelled: false }));
        assert_eq!(advance(&mut pipeline), []);
        assert_eq!(ready(&mut pipeline), None);
        assert_eq!(advance(&mut pipeline), [('a', ParseBind)]);
        read(&mut pipeline, DESCRIBED);
        let outcome = error(&mut pipeline, StaleStatement);
        assert!(matches!(outcome, OnError::Fail { .. }));
    }

    #[test]
    fn a_stale_statement_is_not_retried_with_a_request_behind_it() {
        let (mut pipeline, statement) = prepared(true);
        push(&mut pipeline, 'a', &statement);
        push(&mut pipeline, 'b', &statement);
        advance(&mut pipeline);
        let outcome = error(&mut pipeline, StaleStatement);
        assert!(matches!(outcome, OnError::Fail { .. }));
    }

    #[test]
    fn a_request_is_found_after_others_left() {
        let (mut pipeline, statement) = prepared(false);
        let [a, b, c, d] = ['a', 'b', 'c', 'd'].map(|name| push(&mut pipeline, name, &statement));
        assert!(pipeline.pop().is_some() && pipeline.unqueue(&c).is_some());
        let live = [&a, &b, &c, &d].map(|request| pipeline.is_live(request));
        assert_eq!(live, [false, true, false, true]);
    }

    #[test]
    fn a_retry_says_that_the_request_was_cancelled() {
        let (mut pipeline, statement) = prepared(true);
        let request = push(&mut pipeline, 'a', &statement);
        advance(&mut pipeline);
        pipeline.cancel(&request);
        pipeline.on_cancel_dialed();
        let outcome = error(&mut pipeline, StaleStatement);
        assert!(matches!(outcome, OnError::Retry { cancelled: true }));
    }

    #[test]
    fn a_cancel_request_stops_nothing_that_somebody_waits_for() {
        let (mut pipeline, statement) = prepared(true);
        let [a, b] = ['a', 'b'].map(|name| push(&mut pipeline, name, &statement));
        advance(&mut pipeline);
        for request in [&a, &b] {
            assert!(pipeline.to_stop().is_none());
            let cancelled = pipeline.cancel(request);
            assert!(matches!(
                cancelled,
                Some(OnCancel::InFlight { may_run: true })
            ));
            assert!(pipeline.reject(request) && !pipeline.reject(request));
        }
        let [_, d] = ['c', 'd'].map(|name| push(&mut pipeline, name, &statement));
        assert!(matches!(pipeline.cancel(&d), Some(OnCancel::Unqueued(_))));
        for name in ['a', 'b'] {
            assert_eq!(pipeline.to_stop().map(|it| it.0), Some(name));
            pipeline.on_cancel_dialed();
            assert_eq!(ready(&mut pipeline), Some(name));
            assert!(pipeline.to_stop().is_none());
            assert_eq!(advance(&mut pipeline), []);
            pipeline.on_cancel_ended();
        }
        assert_eq!(advance(&mut pipeline), [('c', Bind)]);
    }

    fn running() -> (Pipeline, Rc<Request>) {
        let mut pipeline = Pipeline::new(true);
        let request = push_simple(&mut pipeline, 'a');
        advance(&mut pipeline);
        (pipeline, request)
    }

    #[test]
    fn cancel_leaves_a_kept_error_alone() {
        let (mut pipeline, request) = running();
        error(&mut pipeline, Other);
        assert!(pipeline.cancel(&request).is_none());
        assert!(pipeline.on_ready_for_query(b'I').unwrap().keeps_error());
    }

    #[test]
    fn cancel_stops_a_copy_that_the_host_has_just_rejected() {
        let (mut pipeline, request) = running();
        pipeline.reject(&request);
        pipeline.cancel(&request);
        assert!(pipeline.to_stop().is_some());
    }

    #[test]
    fn a_second_cancel_waits_for_the_first() {
        let (mut pipeline, request) = running();
        pipeline.cancel(&request);
        pipeline.on_cancel_dialed();
        pipeline.cancel(&request);
        assert!(pipeline.is_live(&request) && pipeline.to_stop().is_none());
        pipeline.on_cancel_ended();
        assert!(pipeline.to_stop().is_some());
    }

    #[test]
    fn a_request_that_ended_is_not_written() {
        let mut pipeline = Pipeline::new(true);
        let request = push_simple(&mut pipeline, 'a');
        pipeline.cancel(&request);
        assert!(!pipeline.wrote(&request, Step::Query));

        push_simple(&mut pipeline, 'b');
        error(&mut pipeline, Canceled);
        assert_eq!(advance(&mut pipeline), [('b', Never)]);
    }

    #[test]
    fn a_reply_to_nothing_is_an_error() {
        let mut pipeline = Pipeline::new(true);
        assert_eq!(pipeline.on_result(), Err(Error::ExpectedRequest));
        assert!(pipeline.on_error(Other, (), |_| named(0)).is_none());
        pipeline.on_cancel_dialed();
        assert_eq!(ready(&mut pipeline), None);
    }
}
