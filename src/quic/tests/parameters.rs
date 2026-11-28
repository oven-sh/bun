use bun_quic::Layer::Transport;
use bun_quic::transport_code::*;
use bun_quic::{ConnectionId, PreferredAddress, TransportParameters};

use crate::harness::raw::Raw;
use crate::harness::wire::{MAX, hex, show_hex};

const PREFERRED: &str = "c63364020001 20010db8000000000000000000000002 0002 02abcd \
                         000102030405060708090a0b0c0d0e0f";

fn advertised(raw: &mut Raw) -> String {
    raw.start(&[]);
    let mut parameters = raw.peer_parameters();
    parameters.retain(|it| !it.0.ends_with("_id") && !it.0.ends_with("_token"));
    parameters.sort();
    let parameters = parameters.iter().map(|it| format!("{}={}", it.0, it.1));
    parameters.collect::<Vec<_>>().join(" ")
}

fn error_for(mut raw: Raw) -> Option<u64> {
    raw.start(&[]);
    if raw.peer.closed.is_none() {
        raw.shake_hands();
    }
    let error = raw.error();
    assert_eq!(raw.peer.has_logged("ready"), error.is_none());
    error.map(|it| it.1)
}

#[test]
fn what_is_advertised() {
    let [mut client, mut server] = Raw::both();
    assert_eq!(
        advertised(&mut client),
        "active_connection_id_limit=8 max_data=1572864 max_idle_timeout=30000 \
         max_stream_data_bidi_remote=1048576 max_stream_data_uni=12288 max_streams_bidi=100 \
         max_streams_uni=3 min_ack_delay=10000 version_information=#000000016b3343cf00000001"
    );
    assert_eq!(
        advertised(&mut server),
        "active_connection_id_limit=8 max_data=15728640 max_idle_timeout=30000 \
         max_stream_data_bidi_local=6291456 max_stream_data_uni=32768 max_streams_bidi=100 \
         max_streams_uni=3 min_ack_delay=10000 version_information=#000000016b3343cf00000001"
    );
    let mut raw = Raw::client().config(|it| {
        let parameters = &mut it.parameters;
        *parameters = TransportParameters::default();
        parameters.max_udp_payload_size = 1500;
        parameters.initial_max_data = MAX;
        parameters.initial_max_stream_data_bidi_local = 63;
        parameters.initial_max_stream_data_bidi_remote = 64;
        parameters.initial_max_stream_data_uni = 16383;
        parameters.initial_max_streams_bidi = 16384;
        parameters.initial_max_streams_uni = 1 << 30;
        parameters.ack_delay_exponent = 7;
        parameters.max_ack_delay_millis = 7;
        parameters.active_connection_id_limit = 7;
        parameters.disable_active_migration = true;
        parameters.max_datagram_frame_size = (1 << 30) - 1;
    });
    assert_eq!(
        advertised(&mut raw),
        format!(
            "active_connection_id_limit=8 disable_active_migration=# max_data={MAX} \
             max_datagram_frame_size=1073741823 max_stream_data_bidi_local=63 \
             max_stream_data_bidi_remote=64 max_stream_data_uni=16383 max_streams_bidi=16384 \
             max_streams_uni=1073741824 max_udp_payload_size=1500 min_ack_delay=10000 \
             version_information=#000000016b3343cf00000001"
        )
    );
}

/// RFC 9000 §7.3.
#[test]
fn connection_ids_are_repeated() {
    for mut raw in Raw::both() {
        raw.start(&[]);
        let is_client = raw.side.is_client();
        for (name, expected) in [
            ("initial_source_connection_id", Some(&raw.destination)),
            (
                "original_destination_connection_id",
                is_client.then_some(&raw.original),
            ),
            ("retry_source_connection_id", None),
        ] {
            assert_eq!(raw.peer_parameter(name), expected.map(|it| show_hex(it)));
        }
        let token = raw.peer_parameter("stateless_reset_token");
        assert_eq!(token.map(|it| it.len()), is_client.then_some(1 + 32));
        let id = ConnectionId::new(&raw.destination);
        let local = raw.connection().local_parameters();
        assert_eq!(local.initial_source_connection_id, id);
    }
}

#[test]
fn preferred_addresses_that_are_advertised() {
    let unspecified = "00000000000000000000000000000000";
    for (ipv4, ipv6, expected) in [
        (
            "198.51.100.2:1",
            "",
            format!("c63364020001{unspecified}0000"),
        ),
        (
            "",
            "[2001:db8::2]:2",
            "00000000000020010db80000000000000000000000020002".into(),
        ),
    ] {
        let address = PreferredAddress::new(ipv4.parse().ok(), ipv6.parse().ok());
        let mut raw = Raw::client().config(|it| it.parameters.preferred_address = Some(address));
        raw.start(&[]);
        let value = hex(&raw.peer_parameter("preferred_address").unwrap());
        assert_eq!(value[..25], hex(&format!("{expected}08")));
        assert_eq!(value.len(), 25 + 8 + 16);
        raw.shake_hands();
        assert!(!raw.frames().ends_with("new_connection_id 1 0"));
        raw.destination = value[25..33].to_vec();
        raw.send("ping, ping");
        assert_eq!(raw.connection().stats().pings_received, 2);
    }
}

#[test]
fn what_the_peer_advertises() {
    let mut raw = Raw::server().with(
        "max_idle_timeout=1001 max_udp_payload_size=1202 max_data=3 max_stream_data_bidi_local=4
        max_stream_data_bidi_remote=5 max_stream_data_uni=6 max_streams_bidi=7 max_streams_uni=8
        ack_delay_exponent=9 max_ack_delay=10 disable_active_migration=-
        active_connection_id_limit=11 max_datagram_frame_size=12 stateless_reset_token=*16 19=a",
    );
    raw.set(&format!("preferred_address={}", show_hex(&hex(PREFERRED))));
    raw.more_parameters = hex("1b00 1b0161 4039 02abcd 1200 2100 3f00");
    raw = raw.connected();
    let ids = [&raw.original, &raw.source].map(|it| ConnectionId::new(it));
    let peer = raw.connection().peer_parameters().unwrap();
    assert_eq!(
        [
            peer.max_idle_timeout_millis,
            peer.max_udp_payload_size,
            peer.initial_max_data,
            peer.initial_max_stream_data_bidi_local,
            peer.initial_max_stream_data_bidi_remote,
            peer.initial_max_stream_data_uni,
            peer.initial_max_streams_bidi,
            peer.initial_max_streams_uni,
            peer.ack_delay_exponent,
            peer.max_ack_delay_millis,
            peer.active_connection_id_limit,
            peer.max_datagram_frame_size,
        ],
        [1001, 1202, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    );
    assert!(peer.disable_active_migration);
    assert_eq!(peer.original_destination_connection_id, ids[0]);
    assert_eq!(peer.initial_source_connection_id, ids[1]);
    assert_eq!(peer.retry_source_connection_id, None);
    let preferred = peer.preferred_address.as_ref().unwrap();
    assert_eq!(preferred.ipv4, "198.51.100.2:1".parse().ok());
    assert_eq!(preferred.ipv6, "[2001:db8::2]:2".parse().ok());
}

#[test]
fn defaults() {
    let names = "max_data= max_stream_data_bidi_local= max_stream_data_bidi_remote=
        max_stream_data_uni= max_streams_bidi= max_streams_uni= max_udp_payload_size=";
    let mut raw = Raw::client().with(names).connected();
    let mut expected = TransportParameters::default();
    expected.initial_source_connection_id = ConnectionId::new(&raw.source);
    assert_eq!(raw.connection().peer_parameters(), Some(&expected));
    assert_eq!(
        [
            expected.max_udp_payload_size,
            expected.ack_delay_exponent,
            expected.max_ack_delay_millis,
            expected.active_connection_id_limit,
        ],
        [65527, 3, 25, 2]
    );
    assert_eq!(
        [
            expected.max_idle_timeout_millis,
            expected.initial_max_data,
            expected.initial_max_stream_data_bidi_local,
            expected.initial_max_stream_data_bidi_remote,
            expected.initial_max_stream_data_uni,
            expected.initial_max_streams_bidi,
            expected.initial_max_streams_uni,
            expected.max_datagram_frame_size,
        ],
        [0; 8]
    );
}

#[test]
fn preferred_addresses_for_one_family() {
    for (zeros, has_ipv4, has_ipv6) in [
        (0..4, false, true),
        (4..6, false, true),
        (6..22, true, false),
        (22..24, true, false),
    ] {
        let mut value = hex(PREFERRED);
        value[zeros].fill(0);
        let parameter = format!("preferred_address={}", show_hex(&value));
        let mut raw = Raw::server().with(&parameter).connected();
        let peer = raw.connection().peer_parameters().unwrap();
        let preferred = peer.preferred_address.as_ref().unwrap();
        assert_eq!(preferred.ipv4.is_some(), has_ipv4);
        assert_eq!(preferred.ipv6.is_some(), has_ipv6);
    }
}

/// RFC 9000 §18.2.
#[test]
fn preferred_addresses_need_ids() {
    let (address, token) = ("01".repeat(24), "02".repeat(16));
    for (source, id) in [
        (&b"raw-id-0"[..], "00"),
        (b"", "01aa"),
        (b"raw-id-0", "15aa"),
    ] {
        let id = if id == "15aa" {
            format!("15{}", "aa".repeat(21))
        } else {
            id.into()
        };
        let mut raw = Raw::server().with(&format!("preferred_address=#{address}{id}{token}"));
        raw.source = source.to_vec();
        raw.start(&[]);
        raw.shake_hands();
        assert_eq!(raw.error(), Some((Transport, TRANSPORT_PARAMETER_ERROR)));
    }
}

#[test]
fn ranges() {
    for (name, valid, invalid) in [
        ("max_udp_payload_size", 1200, 1199),
        ("ack_delay_exponent", 20, 21),
        ("max_ack_delay", (1 << 14) - 1, 1 << 14),
        ("min_ack_delay", 25_000, 25_001),
        ("active_connection_id_limit", 2, 1),
        ("max_streams_bidi", 1000, (1u64 << 60) + 1),
        ("max_streams_uni", 1000, (1 << 60) + 1),
    ] {
        for (value, error) in [(valid, None), (invalid, Some(TRANSPORT_PARAMETER_ERROR))] {
            for raw in Raw::both() {
                let raw = raw.with(&format!("{name}={value}"));
                assert_eq!(error_for(raw), error, "{name}={value}");
            }
        }
    }
}

#[test]
fn malformed_parameters() {
    for parameter in [
        "max_data=-",
        "max_data=#40",
        "max_data=#0101",
        "min_ack_delay=-",
        "disable_active_migration=a",
        "stateless_reset_token=*15",
        "stateless_reset_token=*17",
        "initial_source_connection_id=",
        "initial_source_connection_id=raw-id-1",
        "initial_source_connection_id=*21",
        "original_destination_connection_id=-",
        "original_destination_connection_id=*21",
        "retry_source_connection_id=raw-id-0",
        "retry_source_connection_id=*21",
        "version_information=-",
        "version_information=#000001",
        "version_information=#0000000100",
        "version_information=#0000000000000001",
        "version_information=#000000010000000100000000",
    ] {
        for raw in Raw::both() {
            let error = error_for(raw.with(parameter));
            assert_eq!(error, Some(TRANSPORT_PARAMETER_ERROR), "{parameter}");
        }
    }
    for more in ["40", "1b", "1b01", "040101", "0c000c00", "200101 200101"] {
        for mut raw in Raw::both() {
            raw.more_parameters = hex(more);
            assert_eq!(error_for(raw), Some(TRANSPORT_PARAMETER_ERROR), "{more}");
        }
    }
    let value = hex(&format!("{PREFERRED}00"));
    for len in (0..=value.len()).filter(|&it| it != value.len() - 1) {
        let parameter = format!("preferred_address={}", show_hex(&value[..len]));
        let error = error_for(Raw::server().with(&parameter));
        assert_eq!(error, Some(TRANSPORT_PARAMETER_ERROR), "{len}");
    }
    let raw = Raw::server().with("original_destination_connection_id=");
    assert_eq!(error_for(raw), Some(TRANSPORT_PARAMETER_ERROR));
}

#[test]
fn parameters_that_only_a_server_sends() {
    for parameter in [
        "original_destination_connection_id=original",
        "stateless_reset_token=*16",
        &format!("preferred_address={}", show_hex(&hex(PREFERRED))),
    ] {
        let error = error_for(Raw::client().with(parameter));
        assert_eq!(error, Some(TRANSPORT_PARAMETER_ERROR), "{parameter}");
    }
}

#[test]
fn where_the_error_is_sent() {
    let [mut client, mut server] = Raw::both().map(|it| it.with("ack_delay_exponent=21"));
    client.start(&[]);
    assert_eq!(client.packets(), "I[ack 0, close 0x8]");
    server.start(&[]);
    server.forget();
    server.shake_hands();
    let packets = "I[ack 0, close 0x8] H[close 0x8] 1[close 0x8]";
    assert_eq!(server.packets(), packets);
    assert_eq!(server.error(), Some((Transport, TRANSPORT_PARAMETER_ERROR)));
}

#[test]
fn reset_token_is_not_shown() {
    let [first, second] = ["*16", "sixteen-bytes-xy"].map(|token| {
        let raw = Raw::server().with(&format!("stateless_reset_token={token}"));
        format!("{:?}", raw.connected().connection().peer_parameters())
    });
    assert_eq!(first, second);
}
