//! RFC 9000 §18.

use core::net::{Ipv4Addr, Ipv6Addr, SocketAddrV4, SocketAddrV6};

use crate::cid::{ConnectionId, ResetToken};
use crate::coding::{Read, Write, varint_len};
use crate::frame::MAX_STREAM_COUNT;
use crate::packet::MIN_DATAGRAM_LEN;
use crate::stream_id::Side;

mod id {
    pub(super) const ORIGINAL_DESTINATION_CONNECTION_ID: u64 = 0x00;
    pub(super) const MAX_IDLE_TIMEOUT: u64 = 0x01;
    pub(super) const STATELESS_RESET_TOKEN: u64 = 0x02;
    pub(super) const MAX_UDP_PAYLOAD_SIZE: u64 = 0x03;
    pub(super) const INITIAL_MAX_DATA: u64 = 0x04;
    pub(super) const INITIAL_MAX_STREAM_DATA_BIDI_LOCAL: u64 = 0x05;
    pub(super) const INITIAL_MAX_STREAM_DATA_BIDI_REMOTE: u64 = 0x06;
    pub(super) const INITIAL_MAX_STREAM_DATA_UNI: u64 = 0x07;
    pub(super) const INITIAL_MAX_STREAMS_BIDI: u64 = 0x08;
    pub(super) const INITIAL_MAX_STREAMS_UNI: u64 = 0x09;
    pub(super) const ACK_DELAY_EXPONENT: u64 = 0x0a;
    pub(super) const MAX_ACK_DELAY: u64 = 0x0b;
    pub(super) const DISABLE_ACTIVE_MIGRATION: u64 = 0x0c;
    pub(super) const PREFERRED_ADDRESS: u64 = 0x0d;
    pub(super) const ACTIVE_CONNECTION_ID_LIMIT: u64 = 0x0e;
    pub(super) const INITIAL_SOURCE_CONNECTION_ID: u64 = 0x0f;
    pub(super) const RETRY_SOURCE_CONNECTION_ID: u64 = 0x10;
    /// RFC 9368 §3.
    pub(super) const VERSION_INFORMATION: u64 = 0x11;
    /// RFC 9221 §3.
    pub(super) const MAX_DATAGRAM_FRAME_SIZE: u64 = 0x20;
    /// draft-ferrieuxhamchaoui-quic-lossbits-03 §5.
    pub(super) const LOSS_BITS: u64 = 0x1057;
    /// draft-iyengar-quic-delayed-ack-02 §3.
    pub(super) const MIN_ACK_DELAY: u64 = 0xff02_de1a;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportParameters {
    pub original_destination_connection_id: Option<ConnectionId>,
    pub initial_source_connection_id: Option<ConnectionId>,
    pub retry_source_connection_id: Option<ConnectionId>,
    pub(crate) stateless_reset_token: Option<ResetToken>,
    pub max_idle_timeout_millis: u64,
    pub max_udp_payload_size: u64,
    pub initial_max_data: u64,
    pub initial_max_stream_data_bidi_local: u64,
    pub initial_max_stream_data_bidi_remote: u64,
    pub initial_max_stream_data_uni: u64,
    pub initial_max_streams_bidi: u64,
    pub initial_max_streams_uni: u64,
    pub ack_delay_exponent: u64,
    pub max_ack_delay_millis: u64,
    pub disable_active_migration: bool,
    pub preferred_address: Option<PreferredAddress>,
    pub active_connection_id_limit: u64,
    pub(crate) version_information: Option<VersionInformation>,
    pub max_datagram_frame_size: u64,
    pub(crate) min_ack_delay_micros: Option<u64>,
    pub(crate) sends_loss_bits: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreferredAddress {
    pub ipv4: Option<SocketAddrV4>,
    pub ipv6: Option<SocketAddrV6>,
    pub(crate) id: ConnectionId,
    pub(crate) reset_token: ResetToken,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VersionInformation {
    pub(crate) chosen: u32,
    pub(crate) available: Vec<u32>,
}

impl Default for TransportParameters {
    /// What holds for parameters that are absent.
    fn default() -> Self {
        Self {
            original_destination_connection_id: None,
            initial_source_connection_id: None,
            retry_source_connection_id: None,
            stateless_reset_token: None,
            max_idle_timeout_millis: 0,
            max_udp_payload_size: 65527,
            initial_max_data: 0,
            initial_max_stream_data_bidi_local: 0,
            initial_max_stream_data_bidi_remote: 0,
            initial_max_stream_data_uni: 0,
            initial_max_streams_bidi: 0,
            initial_max_streams_uni: 0,
            ack_delay_exponent: 3,
            max_ack_delay_millis: 25,
            disable_active_migration: false,
            preferred_address: None,
            active_connection_id_limit: 2,
            version_information: None,
            max_datagram_frame_size: 0,
            min_ack_delay_micros: None,
            sends_loss_bits: false,
        }
    }
}

impl TransportParameters {
    fn integers(&mut self) -> [(u64, &mut u64); 12] {
        [
            (id::MAX_IDLE_TIMEOUT, &mut self.max_idle_timeout_millis),
            (id::MAX_UDP_PAYLOAD_SIZE, &mut self.max_udp_payload_size),
            (id::INITIAL_MAX_DATA, &mut self.initial_max_data),
            (
                id::INITIAL_MAX_STREAM_DATA_BIDI_LOCAL,
                &mut self.initial_max_stream_data_bidi_local,
            ),
            (
                id::INITIAL_MAX_STREAM_DATA_BIDI_REMOTE,
                &mut self.initial_max_stream_data_bidi_remote,
            ),
            (
                id::INITIAL_MAX_STREAM_DATA_UNI,
                &mut self.initial_max_stream_data_uni,
            ),
            (
                id::INITIAL_MAX_STREAMS_BIDI,
                &mut self.initial_max_streams_bidi,
            ),
            (
                id::INITIAL_MAX_STREAMS_UNI,
                &mut self.initial_max_streams_uni,
            ),
            (id::ACK_DELAY_EXPONENT, &mut self.ack_delay_exponent),
            (id::MAX_ACK_DELAY, &mut self.max_ack_delay_millis),
            (
                id::ACTIVE_CONNECTION_ID_LIMIT,
                &mut self.active_connection_id_limit,
            ),
            (
                id::MAX_DATAGRAM_FRAME_SIZE,
                &mut self.max_datagram_frame_size,
            ),
        ]
    }

    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(160);
        let mut put = |id, value: &[u8]| {
            out.varint(id);
            out.prefixed_bytes(value);
        };
        for (id, value) in [
            (
                id::ORIGINAL_DESTINATION_CONNECTION_ID,
                &self.original_destination_connection_id,
            ),
            (
                id::INITIAL_SOURCE_CONNECTION_ID,
                &self.initial_source_connection_id,
            ),
            (
                id::RETRY_SOURCE_CONNECTION_ID,
                &self.retry_source_connection_id,
            ),
        ] {
            value.inspect(|value| put(id, value));
        }
        if let Some(token) = self.stateless_reset_token {
            put(id::STATELESS_RESET_TOKEN, &token.0);
        }
        if self.disable_active_migration {
            put(id::DISABLE_ACTIVE_MIGRATION, &[]);
        }
        if let Some(address) = &self.preferred_address {
            put(id::PREFERRED_ADDRESS, &address.encode());
        }
        if let Some(information) = &self.version_information {
            put(id::VERSION_INFORMATION, &information.encode());
        }
        let (mut this, mut defaults) = (self.clone(), Self::default());
        let integers = (this.integers().into_iter().zip(defaults.integers()))
            .filter(|((_, value), (_, default))| value != default)
            .map(|((id, value), _)| (id, *value))
            .chain(self.min_ack_delay_micros.map(|it| (id::MIN_ACK_DELAY, it)));
        for (id, value) in integers {
            out.varint(id);
            out.varint(varint_len(value) as u64);
            out.varint(value);
        }
        out
    }

    pub(crate) fn decode(mut input: &[u8], sender: Side) -> Option<Self> {
        let mut this = Self::default();
        let mut seen = 0u64;
        while !input.is_empty() {
            let (id, mut value) = (input.varint()?, input.prefixed_bytes()?);
            let bit = match id {
                ..=id::VERSION_INFORMATION | id::MAX_DATAGRAM_FRAME_SIZE => id,
                id::LOSS_BITS if sender.is_client() => 62,
                id::MIN_ACK_DELAY => 63,
                _ => continue,
            };
            if seen >> bit & 1 != 0 {
                return None;
            }
            seen |= 1 << bit;
            this.set(id, &mut value)?;
            if !value.is_empty() {
                return None;
            }
        }
        this.is_valid(sender).then_some(this)
    }

    fn set(&mut self, id: u64, value: &mut &[u8]) -> Option<()> {
        let connection_id = |value: &mut &[u8]| ConnectionId::new(core::mem::take(value));
        match id {
            id::ORIGINAL_DESTINATION_CONNECTION_ID => {
                self.original_destination_connection_id = Some(connection_id(value)?);
            }
            id::INITIAL_SOURCE_CONNECTION_ID => {
                self.initial_source_connection_id = Some(connection_id(value)?);
            }
            id::RETRY_SOURCE_CONNECTION_ID => {
                self.retry_source_connection_id = Some(connection_id(value)?);
            }
            id::STATELESS_RESET_TOKEN => {
                self.stateless_reset_token = Some(ResetToken(value.array()?));
            }
            id::DISABLE_ACTIVE_MIGRATION => self.disable_active_migration = true,
            id::PREFERRED_ADDRESS => self.preferred_address = Some(PreferredAddress::read(value)?),
            id::VERSION_INFORMATION => {
                self.version_information = Some(VersionInformation::read(value)?);
            }
            id::LOSS_BITS => self.sends_loss_bits = value.varint()? == 1,
            id::MIN_ACK_DELAY => self.min_ack_delay_micros = Some(value.varint()?),
            _ => {
                let integer = self.integers().into_iter().find(|it| it.0 == id);
                (integer.zip(value.varint())).map(|(it, value)| *it.1 = value)?;
            }
        }
        Some(())
    }

    /// What holds for early data on the next connection (RFC 9000 §7.4.1).
    pub(crate) fn remembered(&self) -> Self {
        Self {
            max_idle_timeout_millis: self.max_idle_timeout_millis,
            max_udp_payload_size: self.max_udp_payload_size,
            initial_max_data: self.initial_max_data,
            initial_max_stream_data_bidi_local: self.initial_max_stream_data_bidi_local,
            initial_max_stream_data_bidi_remote: self.initial_max_stream_data_bidi_remote,
            initial_max_stream_data_uni: self.initial_max_stream_data_uni,
            initial_max_streams_bidi: self.initial_max_streams_bidi,
            initial_max_streams_uni: self.initial_max_streams_uni,
            disable_active_migration: self.disable_active_migration,
            active_connection_id_limit: self.active_connection_id_limit,
            max_datagram_frame_size: self.max_datagram_frame_size,
            ..Self::default()
        }
    }

    /// RFC 9000 §7.4.1 and RFC 9221 §3.
    pub(crate) fn reduces(&self, old: &Self) -> bool {
        self.active_connection_id_limit < old.active_connection_id_limit
            || self.initial_max_data < old.initial_max_data
            || self.initial_max_stream_data_bidi_local < old.initial_max_stream_data_bidi_local
            || self.initial_max_stream_data_bidi_remote < old.initial_max_stream_data_bidi_remote
            || self.initial_max_stream_data_uni < old.initial_max_stream_data_uni
            || self.initial_max_streams_bidi < old.initial_max_streams_bidi
            || self.initial_max_streams_uni < old.initial_max_streams_uni
            || self.max_datagram_frame_size < old.max_datagram_frame_size
    }

    fn is_valid(&self, sender: Side) -> bool {
        self.max_udp_payload_size >= MIN_DATAGRAM_LEN as u64
            && self.ack_delay_exponent <= 20
            && self.max_ack_delay_millis < 1 << 14
            && self.active_connection_id_limit >= 2
            && self.initial_max_streams_bidi <= MAX_STREAM_COUNT
            && self.initial_max_streams_uni <= MAX_STREAM_COUNT
            && (self.min_ack_delay_micros).is_none_or(|it| it <= self.max_ack_delay_millis * 1000)
            && (self.preferred_address.is_none()
                || (self.initial_source_connection_id).is_none_or(|id| !id.is_empty()))
            && (sender.is_server()
                || self.original_destination_connection_id.is_none()
                    && self.retry_source_connection_id.is_none()
                    && self.stateless_reset_token.is_none()
                    && self.preferred_address.is_none())
    }
}

impl PreferredAddress {
    pub fn new(ipv4: Option<SocketAddrV4>, ipv6: Option<SocketAddrV6>) -> Self {
        Self {
            ipv4,
            ipv6,
            id: ConnectionId::default(),
            reset_token: ResetToken([0; ResetToken::LEN]),
        }
    }

    fn encode(&self) -> Vec<u8> {
        let ipv4 = (self.ipv4).unwrap_or(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0));
        let ipv6 = (self.ipv6).unwrap_or(SocketAddrV6::new(Ipv6Addr::UNSPECIFIED, 0, 0, 0));
        let mut out = ipv4.ip().octets().to_vec();
        out.extend_from_slice(&ipv4.port().to_be_bytes());
        out.extend_from_slice(&ipv6.ip().octets());
        out.extend_from_slice(&ipv6.port().to_be_bytes());
        self.id.write(&mut out);
        out.extend_from_slice(&self.reset_token.0);
        out
    }

    fn read(input: &mut &[u8]) -> Option<Self> {
        let port = |input: &mut &[u8]| input.array().map(u16::from_be_bytes);
        let ipv4 = SocketAddrV4::new(input.array::<4>()?.into(), port(input)?);
        let ipv6 = SocketAddrV6::new(input.array::<16>()?.into(), port(input)?, 0, 0);
        Some(Self {
            ipv4: (!ipv4.ip().is_unspecified() && ipv4.port() != 0).then_some(ipv4),
            ipv6: (!ipv6.ip().is_unspecified() && ipv6.port() != 0).then_some(ipv6),
            id: ConnectionId::read(input).filter(|id| !id.is_empty())?,
            reset_token: ResetToken(input.array()?),
        })
    }
}

impl VersionInformation {
    fn encode(&self) -> Vec<u8> {
        (core::iter::once(&self.chosen).chain(&self.available))
            .flat_map(|version| version.to_be_bytes())
            .collect()
    }

    fn read(input: &mut &[u8]) -> Option<Self> {
        let chosen = u32::from_be_bytes(input.array()?);
        let available: Vec<_> = core::iter::from_fn(|| input.array())
            .map(u32::from_be_bytes)
            .collect();
        (chosen != 0 && available.iter().all(|&it| it > 0)).then_some(Self { chosen, available })
    }
}
