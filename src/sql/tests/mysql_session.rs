use bun_sql::mysql::auth_method::Transport;
use bun_sql::mysql::mysql_request::execute_query;
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::any_mysql_error::Error;
use bun_sql::mysql::protocol::packet_writer::PacketWriter;
use bun_sql::mysql::protocol::prepared_statement::{Execute, ExecuteParam, set_statement_id};
use bun_sql::mysql::session::{
    Command, Event, Failure, Login, ReplyEvent, Session, State, Statement,
};
use bun_sql::shared::SSLMode;

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

/// Stand-ins for C: a digest is all zeros, a pointer is never read. sql-mysql.auth.test.ts covers the real ones.
macro_rules! returns {
    ($($value:literal: $($name:ident)*;)*) => {
        $($(#[unsafe(no_mangle)]
        extern "C" fn $name() -> usize {
            $value
        })*)*
    };
}

returns! {
    0: ERR_clear_error ERR_load_BIO_strings SSL_load_error_strings CRYPTO_library_init
        OpenSSL_add_all_algorithms RSA_free;
    1: SSL_library_init EVP_sha1 EVP_sha256 EVP_Digest EVP_DigestInit EVP_DigestUpdate EVP_DigestFinal
        EVP_MD_CTX_cleanup BIO_new_mem_buf BIO_free PEM_read_bio_RSA_PUBKEY;
    256: RSA_size;
    0xffff_ffff: JSC__parseIndex;
}

macro_rules! not_called_by_tests {
    ($($name:ident)*) => {
        $(#[unsafe(no_mangle)]
        extern "C" fn $name() -> ! {
            panic!(concat!(stringify!($name), " has no stand-in"));
        })*
    };
}

not_called_by_tests! {
    ERR_get_error ERR_error_string ERR_load_ERR_strings ERR_load_crypto_strings
    mi_malloc mi_realloc mi_free mi_usable_size
}

#[unsafe(no_mangle)]
unsafe extern "C" fn RSA_public_encrypt(len: usize, from: *const u8, to: *mut u8) -> i32 {
    // SAFETY: the caller passes `len` bytes and room for `RSA_size` of them.
    unsafe { to.copy_from(from, len) };
    len as i32
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(text: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.iter().take_while(|&&byte| byte != needle).count()
}

const PROTOCOL_41: u32 = 1 << 9;
const SSL: u32 = 1 << 11;
const SECURE_CONNECTION: u32 = 1 << 15;
const PLUGIN_AUTH: u32 = 1 << 19;
const DEPRECATE_EOF: u32 = 1 << 24;
const LEGACY: u32 = 1 | PROTOCOL_41 | SECURE_CONNECTION | PLUGIN_AUTH;
const MODERN: u32 = LEGACY | DEPRECATE_EOF;

fn packet(sequence_id: u8, payload: &[u8]) -> Vec<u8> {
    let [a, b, c, _] = (payload.len() as u32).to_le_bytes();
    [&[a, b, c, sequence_id], payload].concat()
}

fn greeting(capabilities: u32, plugin: &str) -> Vec<u8> {
    let [a, b, c, d] = capabilities.to_le_bytes();
    let payload = [
        &b"\x0amock\0\x01\0\0\0aaaaaaaa\0"[..],
        &[a, b, 45, 2, 0, c, d, 21],
        &[0; 10],
        b"bbbbbbbbbbbb\0",
        plugin.as_bytes(),
        b"\0",
    ];
    packet(0, &payload.concat())
}

const NATIVE: &str = "mysql_native_password";
const CACHING: &str = "caching_sha2_password";
const SHA256: &str = "sha256_password";

const OK: &[u8] = b"\0\0\0\x02\0\0\0";
const ERR: &[u8] = b"\xff\x25\x05#70100interrupted";
const ERR_CODE: u16 = 1317;
const EOF: &[u8] = b"\xfe\0\0\x02\0";

fn switch(plugin: &str) -> Vec<u8> {
    [b"\xfe", plugin.as_bytes(), b"\0cccccccccccccccccccc\0"].concat()
}

fn column(name: &str) -> Vec<u8> {
    let fixed = b"\0\x0c\x2d\0\x10\0\0\0\xfd\0\0\0\0\0";
    [
        &b"\x03def\0\0\0"[..],
        &[name.len() as u8],
        name.as_bytes(),
        fixed,
    ]
    .concat()
}

/// What the session makes of a packet.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Seen {
    Nothing,
    Flush,
    Connected,
    Prepared,
    Refused,
    ColumnsReplaced,
    ColumnRedescribed,
    ColumnRenamed(usize),
    Row,
    RowsEnd { count: u64, last: bool },
    NoRows { last: bool },
    Fails(Error),
    FailsWithErr,
    FailsWithDialog,
}

impl From<Failure<'_>> for Seen {
    fn from(failure: Failure<'_>) -> Self {
        match failure {
            Failure::Protocol(err) => Seen::Fails(err),
            Failure::Server(err) => {
                assert_eq!(err.error_code, ERR_CODE);
                Seen::FailsWithErr
            }
            Failure::UnsupportedPlugin(name) => {
                assert_eq!(name, b"dialog");
                Seen::FailsWithDialog
            }
        }
    }
}

impl From<Event> for Seen {
    fn from(event: Event) -> Self {
        match event {
            Event::None => Seen::Nothing,
            Event::Flush => Seen::Flush,
            Event::Connected => Seen::Connected,
        }
    }
}

impl From<ReplyEvent<'_>> for Seen {
    fn from(event: ReplyEvent<'_>) -> Self {
        match event {
            ReplyEvent::None => Seen::Nothing,
            ReplyEvent::Prepared => Seen::Prepared,
            ReplyEvent::Refused(err) => {
                assert_eq!(err.error_code, ERR_CODE);
                Seen::Refused
            }
            ReplyEvent::ColumnsReplaced => Seen::ColumnsReplaced,
            ReplyEvent::ColumnRedescribed => Seen::ColumnRedescribed,
            ReplyEvent::ColumnRenamed(index) => Seen::ColumnRenamed(index),
            ReplyEvent::Row(_) => Seen::Row,
            ReplyEvent::Result(result) if result.has_columns => Seen::RowsEnd {
                count: result.result_count,
                last: result.is_last_result,
            },
            ReplyEvent::Result(result) => {
                assert_eq!(result.result_count, 0);
                Seen::NoRows {
                    last: result.is_last_result,
                }
            }
        }
    }
}

struct Peer {
    session: Session,
    statement: Statement,
    out: Vec<u8>,
}

fn login(password: &str, ssl_mode: SSLMode) -> Login {
    Login {
        user: b"u"[..].into(),
        password: password.as_bytes().into(),
        database: b""[..].into(),
        ssl_mode,
        allow_public_key_retrieval: true,
        found_rows: false,
    }
}

impl Peer {
    fn new(password: &str, ssl_mode: SSLMode) -> Self {
        Self::over(Transport::Tcp, login(password, ssl_mode))
    }

    fn over(transport: Transport, login: Login) -> Self {
        let mut session = Session::new(login, transport);
        session.on_open();
        Self {
            session,
            statement: Statement::default(),
            out: Vec::new(),
        }
    }

    fn ready(capabilities: u32) -> Self {
        let mut peer = Self::new("", SSLMode::Disable);
        let bytes = [greeting(capabilities, NATIVE), packet(2, OK), packet(1, OK)];
        assert_eq!(
            peer.feed(&bytes.concat(), None),
            [Seen::Flush, Seen::Flush, Seen::Connected]
        );
        peer
    }

    /// Up to the first failure.
    fn feed(&mut self, mut bytes: &[u8], command: Option<Command>) -> Vec<Seen> {
        let mut seen = Vec::new();
        loop {
            let packet = match self.session.next_packet(&mut bytes) {
                Ok(Some(packet)) => packet,
                Ok(None) => return seen,
                Err(err) => {
                    seen.push(Seen::Fails(err));
                    return seen;
                }
            };
            let event = match command {
                None => self
                    .session
                    .on_packet(&packet, &mut self.out)
                    .map(Seen::from),
                Some(command) => self
                    .session
                    .on_reply(&packet, command, &mut self.statement)
                    .map(Seen::from),
            };
            match event {
                Ok(event) => seen.push(event),
                Err(failure) => {
                    seen.push(failure.into());
                    return seen;
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Before {
    Greeting,
    TlsHandshake,
    IdentityCheck,
    NativeVerdict,
    CachingVerdict,
    VerdictAfterSwitchToNative,
    VerdictAfterSwitchFromPublicKey,
    VerdictAfterFullAuth,
    PublicKey,
    PublicKeyAfterTwoSwitches,
    SessionSetup,
    Ready,
    Failed,
}

impl Before {
    const AUTHENTICATING: [Self; 7] = [
        Self::NativeVerdict,
        Self::CachingVerdict,
        Self::VerdictAfterSwitchToNative,
        Self::VerdictAfterSwitchFromPublicKey,
        Self::VerdictAfterFullAuth,
        Self::PublicKey,
        Self::PublicKeyAfterTwoSwitches,
    ];
    const OTHERS: [Self; 6] = [
        Self::Greeting,
        Self::TlsHandshake,
        Self::IdentityCheck,
        Self::SessionSetup,
        Self::Ready,
        Self::Failed,
    ];

    fn peer(self) -> Peer {
        let greets = |plugin| greeting(MODERN, plugin);
        let to = |plugin| packet(2, &switch(plugin));
        let script = match self {
            Self::Greeting | Self::Failed => vec![],
            Self::TlsHandshake | Self::IdentityCheck => vec![greeting(MODERN | SSL, CACHING)],
            Self::NativeVerdict => vec![greets(NATIVE)],
            Self::CachingVerdict => vec![greets(CACHING)],
            Self::VerdictAfterSwitchToNative => vec![greets(NATIVE), to(NATIVE)],
            Self::VerdictAfterSwitchFromPublicKey => vec![greets(SHA256), to(CACHING)],
            Self::VerdictAfterFullAuth => vec![
                greets(CACHING),
                packet(2, b"\x01\x04"),
                packet(4, b"\x01key"),
            ],
            Self::PublicKey => vec![greets(SHA256)],
            Self::PublicKeyAfterTwoSwitches => vec![greets(NATIVE), to(CACHING), to(SHA256)],
            Self::SessionSetup => vec![greets(NATIVE), packet(2, OK)],
            Self::Ready => vec![greets(NATIVE), packet(2, OK), packet(1, OK)],
        };
        let mut peer = Peer::new("pw", SSLMode::Prefer);
        peer.feed(&script.concat(), None);
        match self {
            Self::IdentityCheck => peer.session.on_tls_handshake(),
            Self::Failed => peer.session.fail(),
            _ => {}
        }
        peer
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Sends {
    Ok,
    Err,
    FastAuthSuccess,
    FullAuthRequest,
    OtherMoreData,
    SwitchToNative,
    SwitchToDialog,
    EmptyPacket,
}

impl Sends {
    const ALL: [Self; 8] = [
        Self::Ok,
        Self::Err,
        Self::FastAuthSuccess,
        Self::FullAuthRequest,
        Self::OtherMoreData,
        Self::SwitchToNative,
        Self::SwitchToDialog,
        Self::EmptyPacket,
    ];

    fn payload(self) -> Vec<u8> {
        match self {
            Self::Ok => OK.to_vec(),
            Self::Err => ERR.to_vec(),
            Self::FastAuthSuccess => b"\x01\x03".to_vec(),
            Self::FullAuthRequest => b"\x01\x04".to_vec(),
            Self::OtherMoreData => b"\x01\x05".to_vec(),
            Self::SwitchToNative => switch(NATIVE),
            Self::SwitchToDialog => b"\xfedialog\0".to_vec(),
            Self::EmptyPacket => vec![],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum After {
    Verdict,
    PublicKey,
    SessionSetup,
    Ready,
    Ends(Seen),
}

fn after(before: Before, sends: Sends) -> After {
    let mut peer = before.peer();
    let seen = peer.feed(&packet(2, &sends.payload()), None);
    match (&seen[..], peer.session.state()) {
        (&[end @ (Seen::Fails(_) | Seen::FailsWithErr | Seen::FailsWithDialog)], _) => {
            After::Ends(end)
        }
        (_, State::Verdict(_)) => After::Verdict,
        (_, State::PublicKey(_)) => After::PublicKey,
        (_, State::SessionSetup) => After::SessionSetup,
        (_, State::Ready(_)) => After::Ready,
        (_, state) => panic!("{before:?}, {sends:?}: {seen:?}, {state:?}"),
    }
}

#[test]
fn login_state_by_packet() {
    use Before::*;
    use Sends::*;
    const SERVER_ERROR: After = After::Ends(Seen::FailsWithErr);
    const MALFORMED: After = After::Ends(Seen::Fails(Error::MalformedPacket));
    const AUTH_FAILED: After = After::Ends(Seen::Fails(Error::AuthenticationFailed));
    const NO_GREETING: After = After::Ends(Seen::Fails(Error::UnsupportedProtocolVersion));
    const UNEXPECTED: After = After::Ends(Seen::Fails(Error::UnexpectedPacket));

    #[rustfmt::skip]
    let mut listed = vec![
        (Greeting, Err, SERVER_ERROR),
        (Greeting, EmptyPacket, MALFORMED),
        (IdentityCheck, Err, SERVER_ERROR),
        (NativeVerdict, SwitchToNative, After::Verdict),
        (CachingVerdict, SwitchToNative, After::Verdict),
        (VerdictAfterSwitchFromPublicKey, SwitchToNative, After::Verdict),
        (VerdictAfterFullAuth, SwitchToNative, After::Verdict),
        (VerdictAfterFullAuth, FastAuthSuccess, After::Verdict),
        (VerdictAfterFullAuth, OtherMoreData, AUTH_FAILED),
        (PublicKey, SwitchToNative, After::Verdict),
        (SessionSetup, Ok, After::Ready),
        (SessionSetup, Err, SERVER_ERROR),
        (SessionSetup, EmptyPacket, MALFORMED),
        (Ready, Err, SERVER_ERROR),
    ];
    for before in Before::AUTHENTICATING {
        listed.extend([
            (before, Ok, After::SessionSetup),
            (before, Err, SERVER_ERROR),
            (before, SwitchToDialog, After::Ends(Seen::FailsWithDialog)),
            (before, EmptyPacket, MALFORMED),
        ]);
    }
    for before in [CachingVerdict, VerdictAfterSwitchFromPublicKey] {
        listed.extend([
            (before, FastAuthSuccess, After::Verdict),
            (before, FullAuthRequest, After::PublicKey),
            (before, OtherMoreData, AUTH_FAILED),
        ]);
    }
    // Whatever follows the 0x01 is the key.
    for before in [PublicKey, PublicKeyAfterTwoSwitches] {
        listed.extend([
            (before, FastAuthSuccess, After::Verdict),
            (before, FullAuthRequest, After::Verdict),
            (before, OtherMoreData, After::Verdict),
        ]);
    }

    for before in Before::AUTHENTICATING.into_iter().chain(Before::OTHERS) {
        let otherwise = match before {
            Greeting => NO_GREETING,
            _ => UNEXPECTED,
        };
        for sends in Sends::ALL {
            let row = listed.iter().find(|row| (row.0, row.1) == (before, sends));
            let expected = row.map_or(otherwise, |row| row.2);
            assert_eq!(after(before, sends), expected, "{before:?}, {sends:?}");
        }
    }
}

#[test]
fn a_server_without_tls_is_refused_where_sslmode_asks_for_it() {
    const REFUSED: Seen = Seen::Fails(Error::AuthenticationFailed);
    for (ssl_mode, seen) in [
        (SSLMode::Disable, Seen::Flush),
        (SSLMode::Prefer, Seen::Flush),
        (SSLMode::Require, REFUSED),
        (SSLMode::VerifyCa, REFUSED),
        (SSLMode::VerifyFull, REFUSED),
    ] {
        let mut peer = Peer::new("pw", ssl_mode);
        assert_eq!(peer.feed(&greeting(MODERN, NATIVE), None), [seen]);
        assert_eq!(peer.out.is_empty(), seen == REFUSED);
    }
}

#[test]
fn the_login_follows_the_identity_check() {
    let mut peer = Peer::new("pw", SSLMode::Require);
    peer.feed(&greeting(MODERN | SSL, SHA256), None);
    let ssl_request = core::mem::take(&mut peer.out);
    assert_eq!(ssl_request[..4], [32, 0, 0, 1]);
    peer.session.on_identity_accepted(&mut peer.out).unwrap();
    peer.session.on_tls_handshake();
    assert_eq!(peer.out, b"");
    peer.session.on_identity_accepted(&mut peer.out).unwrap();
    assert_eq!(peer.out[3], 2);
    assert_eq!(peer.out[4..36], ssl_request[4..]);
    assert!(peer.out[36..].starts_with(b"u\0\x03pw\0sha256_password\0"));
}

#[test]
fn the_password_is_encrypted_for_the_key() {
    let mut peer = Peer::new("pw", SSLMode::Disable);
    peer.feed(&greeting(MODERN, SHA256), None);
    peer.out.clear();
    assert_eq!(peer.feed(&packet(2, b"\x01key"), None), [Seen::Flush]);
    assert_eq!(peer.out, packet(3, &[b'p' ^ b'a', b'w' ^ b'a', b'a']));
}

#[test]
fn the_transport_decides_how_the_password_is_sent() {
    use Transport::{Tcp, UnixSocket};
    const KEY_ALLOWED: bool = true;
    const KEY_DENIED: bool = false;
    const REFUSED: Result<&[u8], Error> = Err(Error::PublicKeyRetrievalNotAllowed);
    let full_auth = &[greeting(MODERN, CACHING), packet(2, b"\x01\x04")];
    let switch_to_sha256 = &[greeting(MODERN, NATIVE), packet(2, &switch(SHA256))];
    for ([greeting, demand], transport, allow_public_key_retrieval, answer) in [
        (full_auth, Tcp, KEY_DENIED, REFUSED),
        (full_auth, Tcp, KEY_ALLOWED, Ok(b"\x02")),
        (full_auth, UnixSocket, KEY_DENIED, Ok(b"pw\0")),
        (switch_to_sha256, Tcp, KEY_DENIED, REFUSED),
        (switch_to_sha256, UnixSocket, KEY_DENIED, REFUSED),
        (switch_to_sha256, UnixSocket, KEY_ALLOWED, Ok(b"\x01")),
    ] {
        let login = Login {
            allow_public_key_retrieval,
            ..login("pw", SSLMode::Disable)
        };
        let mut peer = Peer::over(transport, login);
        assert_eq!(peer.feed(greeting, None), [Seen::Flush]);
        peer.out.clear();
        let seen = answer.map_or_else(Seen::Fails, |_| Seen::Flush);
        assert_eq!(peer.feed(demand, None), [seen]);
        assert_eq!(peer.out, answer.map_or(vec![], |sent| packet(3, sent)));
    }

    let login = Login {
        allow_public_key_retrieval: false,
        ..login("pw", SSLMode::Disable)
    };
    let mut peer = Peer::over(Tcp, login);
    assert_eq!(
        peer.feed(&greeting(MODERN, SHA256), None),
        [Seen::Fails(Error::PublicKeyRetrievalNotAllowed)]
    );
    assert_eq!(peer.out, b"");
}

struct Tiny(Option<u8>);

impl ExecuteParam for Tiny {
    fn field_type(&self) -> FieldType {
        match self.0 {
            Some(_) => FieldType::MYSQL_TYPE_TINY,
            None => FieldType::MYSQL_TYPE_NULL,
        }
    }

    fn is_unsigned(&self) -> bool {
        self.0.is_some()
    }

    fn write(&self, packet: &mut PacketWriter<'_>) {
        packet.write(self.0.as_slice());
    }
}

#[test]
fn an_execute_marks_its_null_parameters() {
    let params = [0, 1, 2, 3, 4, 5, 6, 0, 0, 9].map(|value| Tiny((value > 0).then_some(value)));
    let mut out = Vec::new();
    Execute {
        statement_id: 0,
        params: &params,
    }
    .write(&mut out);
    assert_eq!(set_statement_id(&mut out, 0x0403_0201), Some(()));
    assert_eq!(set_statement_id(&mut [], 1), None);
    let (null, tiny) = (&[6, 0][..], &[1, 0x80][..]);
    let payload = [
        &b"\x17\x01\x02\x03\x04\0\x01\0\0\0"[..],
        &[0b1000_0001, 0b01, 1],
        &[null, tiny, tiny, tiny, tiny, tiny, tiny, null, null, tiny].concat(),
        &[1, 2, 3, 4, 5, 6, 9],
    ];
    assert_eq!(out, packet(0, &payload.concat()));
}

/// The payloads get the sequence ids from 1 on.
#[track_caller]
fn assert_reply(capabilities: u32, command: Command, steps: &[(&[u8], Seen)]) {
    let packets = (1..).zip(steps).map(|(id, step)| packet(id, step.0));
    let bytes = packets.collect::<Vec<_>>().concat();
    let expected: Vec<Seen> = steps.iter().map(|step| step.1).collect();
    let seen = Peer::ready(capabilities).feed(&bytes, Some(command));
    assert_eq!(seen, expected);
}

#[test]
#[rustfmt::skip]
fn replies_to_a_prepare() {
    use Command::Prepare;
    use Seen::*;
    let no_definitions = b"\0\x07\0\0\0\0\0\0\0\0\0\0";
    let one_of_each = b"\0\x07\0\0\0\x01\0\x01\0\0\0\0";
    let statement_zero = &[0; 12];
    let (param, column, surplus) = (&column("?"), &column("a"), &column("b"));

    assert_reply(MODERN, Prepare, &[(no_definitions, Prepared)]);
    assert_reply(MODERN, Prepare, &[(one_of_each, Nothing), (param, Nothing), (column, Prepared)]);
    assert_reply(LEGACY, Prepare, &[
        (one_of_each, Nothing),
        (param, Nothing),
        (EOF, Nothing),
        (column, Nothing),
        (surplus, Nothing),
        (EOF, Prepared),
    ]);
    assert_reply(MODERN, Prepare, &[(ERR, Refused)]);
    assert_reply(MODERN, Prepare, &[(one_of_each, Nothing), (ERR, Fails(Error::MalformedPacket))]);
    assert_reply(LEGACY, Prepare, &[
        (one_of_each, Nothing),
        (param, Nothing),
        (column, Nothing),
        (ERR, Nothing),
        (EOF, Prepared),
    ]);
    assert_reply(MODERN, Prepare, &[(EOF, Fails(Error::UnexpectedPacket))]);
    assert_reply(MODERN, Prepare, &[(statement_zero, Fails(Error::InvalidPrepareOKPacket))]);
}

#[test]
#[rustfmt::skip]
fn replies_to_an_execute() {
    use Command::Execute;
    use Seen::*;
    let (a, b) = (&column("a"), &column("b"));
    let a_unsigned = &[&a[..a.len() - 5], &[0x20, 0, 0, 0, 0]].concat();
    let (one_column, row) = (b"\x01", b"\x01x");
    let (end, more) = (b"\xfe\0\0\x02\0\0\0", b"\xfe\0\0\x0a\0\0\0");
    let (no_columns, columns_4096, columns_4097) = (b"\xfc\0\0", b"\xfc\0\x10", b"\xfc\x01\x10");

    assert_reply(MODERN, Execute, &[(OK, NoRows { last: true })]);
    assert_reply(MODERN, Execute, &[
        (one_column, ColumnsReplaced),
        (a, ColumnRenamed(0)),
        (row, Row),
        (row, Row),
        (end, RowsEnd { count: 2, last: true }),
    ]);
    assert_reply(LEGACY, Execute, &[
        (one_column, ColumnsReplaced),
        (a, ColumnRenamed(0)),
        (EOF, Nothing),
        (row, Row),
        (EOF, RowsEnd { count: 1, last: true }),
    ]);
    assert_reply(LEGACY, Execute, &[
        (one_column, ColumnsReplaced),
        (a, ColumnRenamed(0)),
        (row, Row),
        (EOF, Nothing),
        (EOF, RowsEnd { count: 1, last: true }),
    ]);
    assert_reply(MODERN, Execute, &[
        (one_column, ColumnsReplaced),
        (a, ColumnRenamed(0)),
        (more, RowsEnd { count: 0, last: false }),
        (one_column, Nothing),
        (a, Nothing),
        (more, RowsEnd { count: 0, last: false }),
        (one_column, Nothing),
        (a_unsigned, ColumnRedescribed),
        (more, RowsEnd { count: 0, last: false }),
        (one_column, Nothing),
        (b, ColumnRenamed(0)),
        (more, RowsEnd { count: 0, last: false }),
        (OK, NoRows { last: true }),
    ]);
    assert_reply(MODERN, Execute, &[(one_column, ColumnsReplaced), (ERR, Refused)]);
    assert_reply(MODERN, Execute, &[
        (one_column, ColumnsReplaced),
        (a, ColumnRenamed(0)),
        (row, Row),
        (ERR, Refused),
    ]);
    assert_reply(MODERN, Execute, &[(b"\xfb/etc/passwd", Fails(Error::UnexpectedPacket))]);
    assert_reply(MODERN, Execute, &[(no_columns, Fails(Error::UnexpectedPacket))]);
    assert_reply(MODERN, Execute, &[(columns_4096, ColumnsReplaced)]);
    assert_reply(MODERN, Execute, &[(columns_4097, Fails(Error::UnexpectedPacket))]);
    assert_reply(MODERN, Execute, &[(b"", Fails(Error::MalformedPacket))]);
}

#[test]
fn a_packet_out_of_step_is_nobodys() {
    for (payload, seen) in [
        (OK, Seen::Fails(Error::UnexpectedPacket)),
        (ERR, Seen::FailsWithErr),
    ] {
        let bytes = [packet(9, b"\x01"), packet(0, payload)].concat();
        assert_eq!(
            Peer::ready(MODERN).feed(&bytes, Some(Command::Execute)),
            [Seen::ColumnsReplaced, seen]
        );
    }
}

#[test]
fn framing() {
    const MAX: usize = 0xff_ffff;
    let peer = Peer::ready(MODERN);
    let whole = packet(1, OK);
    for end in 0..whole.len() {
        let mut bytes = &whole[..end];
        assert!(matches!(peer.session.next_packet(&mut bytes), Ok(None)));
        assert_eq!(bytes.len(), end);
    }

    let mut upgrading = Peer::new("pw", SSLMode::Require);
    upgrading.feed(&greeting(MODERN | SSL, CACHING), None);
    for end in 1..=whole.len() {
        assert!(upgrading.session.next_packet(&mut &whole[..end]).is_err());
    }

    let mut split = Vec::new();
    execute_query(&vec![b'q'; MAX - 1], &mut split);
    assert_eq!(split[..5], [0xff, 0xff, 0xff, 0, 3]);
    assert_eq!(split[4 + MAX..], [0, 0, 0, 1]);
    let short = split.len() - 1;
    assert!(matches!(
        peer.session.next_packet(&mut &split[..short]),
        Ok(None)
    ));
    let followed = [&split[..], &whole[..]].concat();
    let mut bytes = &followed[..];
    assert!(matches!(peer.session.next_packet(&mut bytes), Ok(Some(_))));
    assert_eq!(bytes, whole);

    let before_login = Peer::new("", SSLMode::Disable);
    assert!(before_login.session.next_packet(&mut &split[..]).is_err());
    split[short] = 2;
    assert!(peer.session.next_packet(&mut &split[..]).is_err());
}

#[test]
fn the_parts_of_a_row_are_joined() {
    const MAX: usize = 0xff_ffff;
    for last_part in [&b""[..], b"end"] {
        let parts = [&vec![1; MAX][..], &vec![2; MAX], last_part];
        let next_row = b"\x01x";
        let wire = [
            packet(3, parts[0]),
            packet(4, parts[1]),
            packet(5, parts[2]),
            packet(6, next_row),
        ]
        .concat();

        let mut peer = Peer::ready(MODERN);
        let columns = [packet(1, b"\x01"), packet(2, &column("a"))];
        peer.feed(&columns.concat(), Some(Command::Execute));
        let mut bytes = &wire[..];
        let joined = peer.session.next_packet(&mut bytes).unwrap().unwrap();
        let event = peer
            .session
            .on_reply(&joined, Command::Execute, &mut peer.statement);
        assert!(matches!(event, Ok(ReplyEvent::Row(reader)) if reader.peek() == parts.concat()));
        assert_eq!(peer.feed(bytes, Some(Command::Execute)), [Seen::Row]);
    }
}
