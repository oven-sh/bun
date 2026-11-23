//! RFC 9001 §A and RFC 9369 §A, with the results of the primitives taken from there.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use bun_quic::Layer::Application;
use bun_quic::crypto::Cipher::{self, Aes128GcmSha256 as Aes, ChaCha20Poly1305Sha256 as ChaCha};
use bun_quic::crypto::{Crypto, HeaderKey, PacketKey};
use bun_quic::tls::{Alert, Handshake, Level, Session, Status};
use bun_quic::{Endpoint, Unrouted, Version};

use crate::harness::crypto::Toy;
use crate::harness::raw::Raw;
use crate::harness::wire::hex;

const CLIENT_CHOSEN_ID: &str = "8394c8f03e515708";
const SERVER_ID: &str = "f067a5502a4262b5";
const CLIENT_IN: &str = "00200f746c73313320636c69656e7420696e00";
const SERVER_IN: &str = "00200f746c7331332073657276657220696e00";
const APPLICATION_SECRET: &str = "9ac312a7f877468ebe69422748ad00a15443f18203a07d6060f688f30f21632b";

struct Samples {
    versions: &'static [Version],
    salt: &'static str,
    initial_secret: &'static str,
    /// For `key`, `iv`, `hp` and `ku`, after the length of the output.
    labels: [&'static str; 4],
    /// The secret, `key`, `iv` and `hp`.
    client: [&'static str; 4],
    server: [&'static str; 4],
    /// `key`, `iv`, `hp` and `ku`.
    application: [&'static str; 4],
    client_initial: Packet,
    server_initial: Packet,
    short: Packet,
    /// The key, the nonce, the first byte with the version, and the tag.
    retry: [&'static str; 4],
}

struct Packet {
    nonce: &'static str,
    header: &'static str,
    protected_header: &'static str,
    /// What is in between.
    skipped: &'static str,
    sample: &'static str,
    mask: &'static str,
    tag: &'static str,
}

const SAMPLES: [Samples; 2] = [
    Samples {
        versions: &[Version::V1],
        salt: "38762cf7f55934b34d179ae6a4c80cadccbb7f0a",
        initial_secret: "7db5df06e7a69e432496adedb00851923595221596ae2ae9fb8115c1e9ed0a44",
        labels: [
            "0e746c7331332071756963206b657900",
            "0d746c733133207175696320697600",
            "0d746c733133207175696320687000",
            "0d746c7331332071756963206b7500",
        ],
        client: [
            "c00cf151ca5be075ed0ebfb5c80323c42d6b7db67881289af4008f1f6c357aea",
            "1f369613dd76d5467730efcbe3b1a22d",
            "fa044b2f42a3fd3b46fb255c",
            "9f50449e04a0e810283a1e9933adedd2",
        ],
        server: [
            "3c199828fd139efd216c155ad844cc81fb82fa8d7446fa7d78be803acdda951b",
            "cf3a5331653c364c88f0f379b6067e37",
            "0ac1493ca1905853b0bba03e",
            "c206b8d9b9f0f37644430b490eeaa314",
        ],
        application: [
            "c6d98ff3441c3fe1b2182094f69caa2ed4b716b65488960a7a984979fb23e1c8",
            "e0459b3474bdd0e44a41c144",
            "25a282b9e82f06f21f488917a4fc8f1b73573685608597d0efcb076b0ab7a7a4",
            "1223504755036d556342ee9361d253421a826c9ecdf3c7148684b36b714881f9",
        ],
        client_initial: Packet {
            nonce: "fa044b2f42a3fd3b46fb255e",
            header: "c300000001088394c8f03e5157080000449e00000002",
            protected_header: "c000000001088394c8f03e5157080000449e7b9aec34",
            skipped: "",
            sample: "d1b1c98dd7689fb8ec11d242b123dc9b",
            mask: "437b9aec36",
            tag: "e221af44860018ab0856972e194cd934",
        },
        server_initial: Packet {
            nonce: "0ac1493ca1905853b0bba03f",
            header: "c1000000010008f067a5502a4262b50040750001",
            protected_header: "cf000000010008f067a5502a4262b5004075c0d9",
            skipped: "5a48",
            sample: "2cd0991cd25b0aac406a5816b6394100",
            mask: "2ec0d8356a",
            tag: "3d20398c276456cbc42158407dd074ee",
        },
        short: Packet {
            nonce: "e0459b3474bdd0e46d417eb0",
            header: "4200bff4",
            protected_header: "4cfe4189",
            skipped: "65",
            sample: "5e5cd55c41f69080575d7999c25a5bfb",
            mask: "aefefe7d03",
            tag: "5e5cd55c41f69080575d7999c25a5bfb",
        },
        retry: [
            "be0c690b9f66575a1d766b54e368c84e",
            "461599d35d632bf2239825bb",
            "ff00000001",
            "04a265ba2eff4d829058fb3f0f2496ba",
        ],
    },
    Samples {
        versions: &[Version::V2],
        salt: "0dede3def700a6db819381be6e269dcbf9bd2ed9",
        initial_secret: "2062e8b3cd8d52092614b8071d0aa1fb7c2e3ac193f78b280e72d8f5751f6aba",
        labels: [
            "10746c73313320717569637632206b657900",
            "0f746c7331332071756963763220697600",
            "0f746c7331332071756963763220687000",
            "0f746c73313320717569637632206b7500",
        ],
        client: [
            "14ec9d6eb9fd7af83bf5a668bc17a7e283766aade7ecd0891f70f9ff7f4bf47b",
            "8b1a0bc121284290a29e0971b5cd045d",
            "91f73e2351d8fa91660e909f",
            "45b95e15235d6f45a6b19cbcb0294ba9",
        ],
        server: [
            "0263db1782731bf4588e7e4d93b7463907cb8cd8200b5da55a8bd488eafc37c1",
            "82db637861d55e1d011f19ea71d5d2a7",
            "dd13c276499c0249d3310652",
            "edf6d05c83121201b436e16877593c3a",
        ],
        application: [
            "3bfcddd72bcf02541d7fa0dd1f5f9eeea817e09a6963a0e6c7df0f9a1bab90f2",
            "a6b5bc6ab7dafce30ffff5dd",
            "d659760d2ba434a226fd37b35c69e2da8211d10c4f12538787d65645d5d1b8e2",
            "c69374c49e3d2a9466fa689e49d476db5d0dfbc87d32ceeaa6343fd0ae4c7d88",
        ],
        client_initial: Packet {
            nonce: "91f73e2351d8fa91660e909d",
            header: "d36b3343cf088394c8f03e5157080000449e00000002",
            protected_header: "d76b3343cf088394c8f03e5157080000449ea0c95e82",
            skipped: "",
            sample: "ffe67b6abcdb4298b485dd04de806071",
            mask: "94a0c95e80",
            tag: "a18b2faa745b6fe189cf772a9f84cbfc",
        },
        server_initial: Packet {
            nonce: "dd13c276499c0249d3310653",
            header: "d16b3343cf0008f067a5502a4262b50040750001",
            protected_header: "dc6b3343cf0008f067a5502a4262b5004075d92f",
            skipped: "aaf1",
            sample: "6f05d8a4398c47089698baeea26b91eb",
            mask: "4dd92e91ea",
            tag: "1a3e2c43edd9ce7ca84bed8521e2e140",
        },
        short: Packet {
            nonce: "a6b5bc6ab7dafce328ff4a29",
            header: "4200bff4",
            protected_header: "5558b1c6",
            skipped: "0a",
            sample: "e7b6b932bc27d786f4bc2bb20f2162ba",
            mask: "97580e32bf",
            tag: "e7b6b932bc27d786f4bc2bb20f2162ba",
        },
        retry: [
            "8fb4b01b56ac48e260fbcbcead7ccc92",
            "d86969bc2d7c6d9990efb04a",
            "cf6b3343cf",
            "c8646ce8bfe33952d955543665dcc7b6",
        ],
    },
];

/// What it does not know stays unprotected, with a tag of zeros.
struct Lookup {
    random: &'static Toy,
    /// From the inputs to the output, and whether it was asked for.
    results: RefCell<BTreeMap<Vec<u8>, (Vec<u8>, bool)>>,
}

impl Lookup {
    fn install(raw: &mut Raw, samples: &Samples) -> &'static Self {
        let (random, results) = (raw.peer.crypto, RefCell::default());
        let this = Box::leak(Box::new(Self { random, results }));
        raw.peer.endpoint = Endpoint::new(Box::leak(Box::new(&*this)));
        raw.peer.config.versions = samples.versions;
        let secret = samples.initial_secret;
        this.set(Aes, &[samples.salt, CLIENT_CHOSEN_ID], secret);
        for (label, [derived, rest @ ..]) in
            [(CLIENT_IN, samples.client), (SERVER_IN, samples.server)]
        {
            this.set(Aes, &[secret, label], derived);
            this.set_expanded(Aes, derived, samples, &rest);
        }
        this
    }

    fn set(&self, cipher: Cipher, inputs: &[&str], output: &str) {
        let inputs = [vec![cipher as u8], hex(&inputs.concat())].concat();
        (self.results.borrow_mut()).insert(inputs, (hex(output), false));
    }

    fn set_expanded(&self, cipher: Cipher, secret: &str, samples: &Samples, outputs: &[&str]) {
        for (label, output) in samples.labels.iter().zip(outputs) {
            let len = format!("{:04x}", output.len() / 2);
            self.set(cipher, &[secret, &len, label], output);
        }
    }

    /// Returns what it wrote to the start of `out`.
    fn get(&self, cipher: Cipher, inputs: &[&[u8]], out: &mut [u8]) -> Option<Vec<u8>> {
        let inputs = [&[cipher as u8], &inputs.concat()[..]].concat();
        let mut results = self.results.borrow_mut();
        let (output, is_used) = results.get_mut(&inputs)?;
        *is_used = true;
        out.iter_mut()
            .zip(&*output)
            .for_each(|(to, from)| *to = *from);
        Some(output.clone())
    }
}

struct Key(&'static Lookup, Cipher, Vec<u8>);

impl Crypto for &'static Lookup {
    fn fill_random(&self, out: &mut [u8]) {
        self.random.fill_random(out);
    }

    fn extract(&self, salt: &[u8], key_material: &[u8]) -> [u8; 32] {
        let mut out = [0; 32];
        self.get(Aes, &[salt, key_material], &mut out);
        out
    }

    fn expand(&self, cipher: Cipher, secret: &[u8], info: &[u8], out: &mut [u8]) {
        self.get(cipher, &[secret, info], out);
    }

    fn packet_key(&self, cipher: Cipher, key: &[u8]) -> Box<dyn PacketKey> {
        Box::new(Key(self, cipher, key.to_vec()))
    }

    fn header_key(&self, cipher: Cipher, key: &[u8]) -> Box<dyn HeaderKey> {
        Box::new(Key(self, cipher, key.to_vec()))
    }
}

impl PacketKey for Key {
    fn seal(&self, nonce: &[u8; 12], header: &[u8], payload: &mut [u8]) -> [u8; 16] {
        let output = self.0.get(self.1, &[&self.2, nonce, header], payload);
        output.map_or([0; 16], |it| *it.last_chunk().unwrap())
    }

    fn open(&self, nonce: &[u8; 12], header: &[u8], payload: &mut [u8], tag: &[u8; 16]) -> bool {
        let output = self.0.get(self.1, &[&self.2, nonce, header, tag], payload);
        output.is_some() || *tag == [0; 16]
    }

    fn confidentiality_limit(&self) -> u64 {
        u64::MAX
    }

    fn integrity_limit(&self) -> u64 {
        u64::MAX
    }
}

impl HeaderKey for Key {
    fn mask(&self, sample: &[u8; 16]) -> [u8; 5] {
        let mut mask = [0; 5];
        self.0.get(self.1, &[&self.2, sample], &mut mask);
        mask
    }
}

struct Script;

impl Session for Script {
    fn resume(&mut self, _: &[u8]) -> bool {
        false
    }

    fn advance(
        &mut self,
        input: Option<(Level, &[u8])>,
        handshake: &mut Handshake<'_>,
    ) -> Result<Status, Alert> {
        if let Some((Level::Handshake, _)) = input {
            handshake.read_secret(Level::Application, ChaCha, &hex(APPLICATION_SECRET));
            return Ok(Status::Complete);
        }
        // Without an ACK frame, this takes up as much as the payload of the sample.
        handshake.send(Level::Initial, &[0; 95]);
        if input.is_some() {
            assert!(handshake.peer_parameters(&hex("0f00"), false));
            handshake.read_secret(Level::Handshake, Aes, &[0; 32]);
            handshake.write_secret(Level::Handshake, Aes, &[0; 32]);
            handshake.send(Level::Handshake, &[0]);
        }
        Ok(Status::InProgress)
    }
}

#[test]
fn packet_protection() {
    for samples in &SAMPLES {
        let mut raw = Raw::client();
        let lookup = Lookup::install(&mut raw, samples);
        let (now, from) = (raw.now, raw.addresses);

        let (packet, [_, key, _, hp]) = (&samples.client_initial, samples.client);
        let payload = format!("060040f1010000ed{}", "00".repeat(1162 - 8));
        lookup.set(Aes, &[hp, packet.sample], packet.mask);
        let inputs = [key, packet.nonce, packet.header, packet.tag];
        lookup.set(Aes, &inputs, &payload);
        let mut datagram = hex(&[packet.protected_header, packet.sample].concat());
        datagram.resize(1200 - 16, 0xaa);
        datagram.extend(hex(packet.tag));
        let endpoint = &mut raw.peer.endpoint;
        let unrouted = endpoint.receive(now, &from, &mut datagram, samples.versions);
        let Some(Unrouted::Incoming(incoming)) = unrouted else {
            panic!();
        };
        raw.peer.crypto.planned.borrow_mut().push(hex(SERVER_ID));
        let config = Rc::new(raw.peer.config.clone());
        raw.peer.handle = Some(endpoint.accept(now, incoming, config, Box::new(Script)));

        let (packet, [_, key, _, hp]) = (&samples.server_initial, samples.server);
        let output = [packet.skipped, packet.sample, packet.tag].concat();
        lookup.set(Aes, &[key, packet.nonce, packet.header], &output);
        lookup.set(Aes, &[hp, packet.sample], packet.mask);
        raw.peer.process(now);
        let later = raw.peer.endpoint.timeout().unwrap();
        let sent = raw.peer.process(later).remove(0).1;
        let start = [packet.protected_header, packet.skipped, packet.sample];
        assert!(sent.starts_with(&hex(&start.concat())));
        assert!(sent[..20 + 99 + 16].ends_with(&hex(packet.tag)));

        let (packet, [key, _, hp, _]) = (&samples.short, samples.application);
        let with_id = |it: &str| [&it[..2], SERVER_ID, &it[2..]].concat();
        lookup.set_expanded(ChaCha, APPLICATION_SECRET, samples, &samples.application);
        lookup.set(ChaCha, &[hp, packet.sample], packet.mask);
        let inputs = [key, packet.nonce, &with_id(packet.header), packet.tag];
        lookup.set(ChaCha, &inputs, "01");
        let (version, tag) = (samples.versions[0], "00".repeat(16));
        let first = if version == Version::V2 { "f0" } else { "e0" };
        let version = version.number();
        for datagram in [
            format!("{first} {version:08x} 08{SERVER_ID} 00 15 00 06000100 {tag}"),
            format!("43 {SERVER_ID} 2700bff3 01 {tag}"),
            with_id(&[packet.protected_header, packet.skipped, packet.sample].concat()),
            format!("47 {SERVER_ID} 2700bff5 01 {tag}"),
        ] {
            raw.peer.receive(later, &from, &mut hex(&datagram));
        }
        assert_eq!(raw.connection().stats().pings_received, 3);
        assert!(lookup.results.borrow().values().all(|it| it.1));
    }
}

#[test]
fn retry() {
    for samples in &SAMPLES {
        let mut raw = Raw::server();
        let lookup = Lookup::install(&mut raw, samples);
        let (now, addresses, id) = (raw.now, raw.addresses, "0001020304050607");
        let chosen = format!("00{CLIENT_CHOSEN_ID}{}", "00".repeat(12));
        *raw.peer.crypto.planned.borrow_mut() = vec![hex(&chosen), hex(id)];
        let config = Rc::new(raw.peer.config.clone());
        (raw.peer.endpoint).connect(now, config, addresses, Box::new(Script), &[]);
        raw.peer.process(now);

        let [key, nonce, start, tag] = samples.retry;
        let packet = format!("{start} 08{id} 08{SERVER_ID} 746f6b656e");
        lookup.set(Aes, &[key, nonce, "08", CLIENT_CHOSEN_ID, &packet], tag);
        (raw.peer).receive(now, &addresses, &mut hex(&format!("{packet}{tag}")));
        let sent = raw.peer.process(now).remove(0).1;
        let expected = hex(&format!("08{SERVER_ID} 08{id} 05746f6b656e"));
        assert!(sent[5..].starts_with(&expected));
        assert!(lookup.results.borrow().values().all(|it| it.1));
    }
}

/// RFC 9000 §A.1.
#[test]
fn variable_length_integers() {
    for (encoded, value) in [
        ("c2197c5eff14e88c", 151_288_809_941_952_652u64),
        ("9d7f3e7d", 494_878_333),
        ("7bbd", 15_293),
        ("25", 37),
        ("4025", 37),
    ] {
        for padding in ["", ", padding 8"] {
            let mut raw = Raw::client().connected();
            raw.send(&format!("#1d{encoded}00{padding}"));
            let events = format!("closed by application_close {value:#x} -");
            assert_eq!(raw.events(), events);
        }
    }
}

#[test]
fn integers_are_as_short_as_possible() {
    for (value, len) in [
        (63, 1),
        (64, 2),
        (16_383, 2),
        (16_384, 4),
        ((1 << 30) - 1, 4),
        (1 << 30, 8),
    ] {
        let mut raw = Raw::client().connected();
        let now = raw.now;
        raw.connection().abort(now, Application, value, &[0; 20]);
        assert_eq!(raw.sizes(), [1 + 8 + 2 + 1 + len + 1 + 20 + 16; 2]);
        assert_eq!(raw.close, Some((Application, value)));
    }
}

/// RFC 9000 §20.1 and RFC 9368 §4.
#[test]
fn error_codes() {
    use bun_quic::transport_code::*;
    let codes = [
        NO_ERROR,
        INTERNAL_ERROR,
        CONNECTION_REFUSED,
        FLOW_CONTROL_ERROR,
        STREAM_LIMIT_ERROR,
        STREAM_STATE_ERROR,
        FINAL_SIZE_ERROR,
        FRAME_ENCODING_ERROR,
        TRANSPORT_PARAMETER_ERROR,
        CONNECTION_ID_LIMIT_ERROR,
        PROTOCOL_VIOLATION,
        INVALID_TOKEN,
        APPLICATION_ERROR,
        CRYPTO_BUFFER_EXCEEDED,
        KEY_UPDATE_ERROR,
        AEAD_LIMIT_REACHED,
    ];
    assert!(codes.into_iter().eq(0..0x10));
    assert_eq!(VERSION_NEGOTIATION_ERROR, 0x11);
}
