use bun_sql::mysql::auth_method::Transport;
use bun_sql::mysql::mysql_request::execute_query;
use bun_sql::mysql::session::{Command, Event, Failure, Login, ReplyEvent, Session, Statement};
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
    0: ERR_clear_error ERR_get_error ERR_error_string ERR_load_ERR_strings ERR_load_BIO_strings
        ERR_load_crypto_strings SSL_load_error_strings CRYPTO_library_init
        OpenSSL_add_all_algorithms RSA_free mi_malloc mi_realloc mi_free mi_usable_size;
    1: SSL_library_init EVP_sha1 EVP_sha256 EVP_Digest EVP_DigestInit EVP_DigestUpdate EVP_DigestFinal
        EVP_MD_CTX_cleanup BIO_new_mem_buf BIO_free PEM_read_bio_RSA_PUBKEY;
    256: RSA_size;
    0xffff_ffff: JSC__parseIndex;
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

fn show(failure: Failure<'_>) -> String {
    match failure {
        Failure::Protocol(err) => format!("!{err:?}"),
        Failure::Server(err) => format!("!{}", err.error_code),
        Failure::UnsupportedPlugin(name) => format!("!{}", name.escape_ascii()),
    }
}

struct Peer {
    session: Session,
    statement: Statement,
    out: Vec<u8>,
}

impl Peer {
    fn new(password: &str, ssl_mode: SSLMode) -> Self {
        let login = Login {
            user: b"u"[..].into(),
            password: password.as_bytes().into(),
            database: b""[..].into(),
            ssl_mode,
            allow_public_key_retrieval: true,
            found_rows: false,
        };
        let mut session = Session::new(login, Transport::Tcp);
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
            ["flush", "flush", "connected"]
        );
        peer
    }

    fn feed(&mut self, mut bytes: &[u8], command: Option<Command>) -> Vec<String> {
        let mut events = Vec::new();
        loop {
            let packet = match self.session.next_packet(&mut bytes) {
                Ok(Some(packet)) => packet,
                Ok(None) => return events,
                Err(err) => {
                    events.push(show(err.into()));
                    return events;
                }
            };
            let event = match command {
                None => self
                    .session
                    .on_packet(&packet, &mut self.out)
                    .map(|event| match event {
                        Event::None => "-".to_string(),
                        Event::Flush => "flush".to_string(),
                        Event::Connected => "connected".to_string(),
                    }),
                Some(command) => self
                    .session
                    .on_reply(&packet, command, &mut self.statement)
                    .map(|event| match event {
                        ReplyEvent::None => "-".to_string(),
                        ReplyEvent::Prepared => "prepared".to_string(),
                        ReplyEvent::Refused(err) => format!("refused {}", err.error_code),
                        ReplyEvent::ColumnsReplaced => "replaced".to_string(),
                        ReplyEvent::ColumnRedescribed => "redescribed".to_string(),
                        ReplyEvent::ColumnRenamed(index) => format!("renamed {index}"),
                        ReplyEvent::Row(_) => "row".to_string(),
                        ReplyEvent::Result(result) => format!(
                            "{}{} rows{}",
                            if result.has_columns { "columns " } else { "" },
                            result.result_count,
                            if result.is_last_result { " last" } else { "" },
                        ),
                    }),
            };
            match event {
                Ok(event) => events.push(event),
                Err(failure) => {
                    events.push(show(failure));
                    return events;
                }
            }
        }
    }
}

/// What comes before the probe, and the state that it leads to.
fn login_states() -> Vec<(&'static str, Peer)> {
    let script = |ssl_mode, parts: &[Vec<u8>]| {
        let mut peer = Peer::new("pw", ssl_mode);
        peer.feed(&parts.concat(), None);
        peer
    };
    let plain = |parts: &[Vec<u8>]| script(SSLMode::Prefer, parts);
    let tls = || script(SSLMode::Require, &[greeting(MODERN | SSL, CACHING)]);
    let mut identity_check = tls();
    identity_check.session.on_tls_handshake();
    let mut failed = plain(&[]);
    failed.session.fail();
    let native = || greeting(MODERN, NATIVE);
    let to = |plugin| packet(2, &switch(plugin));
    vec![
        ("Greeting", plain(&[])),
        ("TlsHandshake", tls()),
        ("IdentityCheck", identity_check),
        ("Verdict native", plain(&[native()])),
        ("Verdict caching", plain(&[greeting(MODERN, CACHING)])),
        ("Verdict switched", plain(&[native(), to(NATIVE)])),
        (
            "PublicKey switched twice",
            plain(&[native(), to(CACHING), to(SHA256)]),
        ),
        ("PublicKey", plain(&[greeting(MODERN, SHA256)])),
        (
            "Verdict after PublicKey",
            plain(&[greeting(MODERN, SHA256), to(CACHING)]),
        ),
        (
            "Verdict after full auth",
            plain(&[
                greeting(MODERN, CACHING),
                packet(2, b"\x01\x04"),
                packet(4, b"\x01key"),
            ]),
        ),
        ("SessionSetup", plain(&[native(), packet(2, OK)])),
        ("Ready", Peer::ready(MODERN)),
        ("Failed", failed),
    ]
}

#[test]
fn login_state_by_packet() {
    let switch = switch(NATIVE);
    let probes: [&[u8]; 8] = [
        OK,
        ERR,
        b"\x01\x03",
        b"\x01\x04",
        b"\x01\x05",
        &switch,
        b"\xfedialog\0",
        b"",
    ];
    let mut table = String::new();
    for row in 0..login_states().len() {
        let cells = probes.map(|probe| {
            let mut peer = login_states().swap_remove(row).1;
            let event = peer.feed(&packet(2, probe), None).concat();
            if event.starts_with('!') {
                return event;
            }
            let state = format!("{:?}", peer.session.state());
            state.split('(').next().unwrap().to_string()
        });
        let cells = cells
            .join(" ")
            .replace("!UnexpectedPacket", "!")
            .replace("Packet", "");
        table += &format!("{}: {cells}\n", login_states()[row].0);
    }
    assert_eq!(
        table,
        "\
Greeting: !UnsupportedProtocolVersion !1317 !UnsupportedProtocolVersion !UnsupportedProtocolVersion !UnsupportedProtocolVersion !UnsupportedProtocolVersion !UnsupportedProtocolVersion !Malformed
TlsHandshake: ! ! ! ! ! ! ! !
IdentityCheck: ! !1317 ! ! ! ! ! !
Verdict native: SessionSetup !1317 ! ! ! Verdict !dialog !Malformed
Verdict caching: SessionSetup !1317 Verdict PublicKey !AuthenticationFailed Verdict !dialog !Malformed
Verdict switched: SessionSetup !1317 ! ! ! ! !dialog !Malformed
PublicKey switched twice: SessionSetup !1317 Verdict Verdict Verdict ! !dialog !Malformed
PublicKey: SessionSetup !1317 Verdict Verdict Verdict Verdict !dialog !Malformed
Verdict after PublicKey: SessionSetup !1317 Verdict PublicKey !AuthenticationFailed Verdict !dialog !Malformed
Verdict after full auth: SessionSetup !1317 Verdict ! !AuthenticationFailed Verdict !dialog !Malformed
SessionSetup: Ready !1317 ! ! ! ! ! !Malformed
Ready: ! !1317 ! ! ! ! ! !
Failed: ! ! ! ! ! ! ! !
"
    );
}

#[test]
fn a_server_without_tls_is_refused_where_sslmode_asks_for_it() {
    use SSLMode::*;
    for ssl_mode in [Disable, Prefer, Require, VerifyCa, VerifyFull] {
        let mut peer = Peer::new("pw", ssl_mode);
        let events = peer.feed(&greeting(MODERN, NATIVE), None);
        let goes_on = matches!(ssl_mode, Disable | Prefer);
        assert_eq!(
            events,
            [if goes_on {
                "flush"
            } else {
                "!AuthenticationFailed"
            }]
        );
        assert_eq!(peer.out.is_empty(), !goes_on);
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
    assert_eq!(peer.feed(&packet(2, b"\x01key"), None), ["flush"]);
    assert_eq!(peer.out, packet(3, &[b'p' ^ b'a', b'w' ^ b'a', b'a']));
}

/// The payloads get the sequence ids from 1 on.
fn reply(capabilities: u32, command: Command, payloads: &[&[u8]]) -> String {
    let packets = (1..).zip(payloads).map(|(id, payload)| packet(id, payload));
    let bytes = packets.collect::<Vec<_>>().concat();
    Peer::ready(capabilities)
        .feed(&bytes, Some(command))
        .join(", ")
}

#[test]
fn replies_to_a_prepare() {
    let one_of_each = &b"\0\x07\0\0\0\x01\0\x01\0\0\0\0"[..];
    let column = &column("a")[..];
    for (capabilities, payloads, events) in [
        (
            MODERN,
            &[&b"\0\x07\0\0\0\0\0\0\0\0\0\0"[..]][..],
            "prepared",
        ),
        (MODERN, &[one_of_each, column, column], "-, -, prepared"),
        (
            LEGACY,
            &[one_of_each, column, EOF, column, column, EOF],
            "-, -, -, -, -, prepared",
        ),
        (MODERN, &[ERR], "refused 1317"),
        (MODERN, &[one_of_each, ERR], "-, refused 1317"),
        (
            LEGACY,
            &[one_of_each, column, EOF, ERR],
            "-, -, -, refused 1317",
        ),
        (MODERN, &[EOF], "!UnexpectedPacket"),
        (MODERN, &[&[0; 12]], "!InvalidPrepareOKPacket"),
    ] {
        assert_eq!(reply(capabilities, Command::Prepare, payloads), events);
    }
}

#[test]
fn replies_to_an_execute() {
    let (a, b) = (&column("a")[..], &column("b")[..]);
    let (one, row) = (&b"\x01"[..], &b"\x01x"[..]);
    let (end, more) = (&b"\xfe\0\0\x02\0\0\0"[..], &b"\xfe\0\0\x0a\0\0\0"[..]);
    for (capabilities, payloads, events) in [
        (MODERN, &[OK][..], "0 rows last"),
        (
            MODERN,
            &[one, a, row, row, end],
            "replaced, renamed 0, row, row, columns 2 rows last",
        ),
        (
            LEGACY,
            &[one, a, EOF, row, EOF],
            "replaced, renamed 0, -, row, columns 1 rows last",
        ),
        (
            LEGACY,
            &[one, a, row, EOF, EOF],
            "replaced, renamed 0, row, -, columns 1 rows last",
        ),
        (
            MODERN,
            &[one, a, more, one, a, more, one, b, more, OK],
            "replaced, renamed 0, columns 0 rows, -, -, columns 0 rows, -, renamed 0, columns 0 rows, 0 rows last",
        ),
        (MODERN, &[one, ERR], "replaced, refused 1317"),
        (
            MODERN,
            &[one, a, row, ERR],
            "replaced, renamed 0, row, refused 1317",
        ),
        (MODERN, &[b"\xfb/etc/passwd"], "!UnexpectedPacket"),
        (MODERN, &[b"\xfc\0\0"], "!UnexpectedPacket"),
        (MODERN, &[b"\xfc\0\x10"], "replaced"),
        (MODERN, &[b"\xfc\x01\x10"], "!UnexpectedPacket"),
        (MODERN, &[b""], "!MalformedPacket"),
    ] {
        assert_eq!(reply(capabilities, Command::Execute, payloads), events);
    }
}

#[test]
fn a_packet_out_of_step_is_nobodys() {
    for (payload, event) in [(OK, "!UnexpectedPacket"), (ERR, "!1317")] {
        let bytes = [packet(9, b"\x01"), packet(0, payload)].concat();
        let events = Peer::ready(MODERN).feed(&bytes, Some(Command::Execute));
        assert_eq!(events, ["replaced", event]);
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

    let mut split = Vec::new();
    execute_query(&vec![b'q'; MAX - 1], &mut split);
    assert_eq!(split[..5], [0xff, 0xff, 0xff, 0, 3]);
    assert_eq!(split[4 + MAX..], [0, 0, 0, 1]);
    let short = split.len() - 1;
    assert!(matches!(
        peer.session.next_packet(&mut &split[..short]),
        Ok(None)
    ));
    let mut bytes = &split[..];
    assert!(matches!(peer.session.next_packet(&mut bytes), Ok(Some(_))));
    assert_eq!(bytes, b"");

    let before_login = Peer::new("", SSLMode::Disable);
    assert!(before_login.session.next_packet(&mut &split[..]).is_err());
    split[short] = 2;
    assert!(peer.session.next_packet(&mut &split[..]).is_err());
}
