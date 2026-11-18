//! How a proxy is asked for a connection to somewhere else.

use core::net::IpAddr;
use std::net::ToSocketAddrs;

use bun_http::browser::{self, Negotiation};
use bun_http1::{HeadOptions, ResponseParser};

use super::auth::{Challenge, Handshake, Identity, Peer};
use super::error::NetError;
use crate::Bytes;
use crate::headers::HeaderList;
use crate::url::Url;

#[derive(Clone, Copy)]
enum Stage {
    Direct,
    ConnectReply,
    /// What is left of the body of a challenge.
    Skipping(usize),
    Socks4Reply,
    Socks5Method,
    Socks5Reply,
}

enum Step {
    /// So many bytes have been dealt with.
    GoesOn(usize),
    Done(usize),
    Failed,
}

pub(super) enum Refusal {
    Error(NetError),
    Challenge(HeaderList),
}

pub(super) struct Tunnel {
    proxy: Url,
    target: Url,
    user_agent: Bytes,
    identity: Option<Identity>,
    /// Of the host of `target`, for the version of SOCKS that knows no names.
    address: Option<[u8; 4]>,
    handshake: Option<Handshake>,
    next_login: Vec<u8>,
    stage: Stage,
    received: Vec<u8>,
    pub refusal: Option<Refusal>,
}

pub(super) fn is_socks(proxy: &Url) -> bool {
    proxy.scheme().starts_with(b"socks")
}

/// Blocks.
pub(super) fn look_up(hostname: &[u8]) -> Option<[u8; 4]> {
    let mut found = (core::str::from_utf8(hostname).ok()?, 0)
        .to_socket_addrs()
        .ok()?;
    found.find_map(|it| {
        if let IpAddr::V4(address) = it.ip() {
            Some(address.octets())
        } else {
            None
        }
    })
}

impl Tunnel {
    pub(super) fn new(
        proxy: &Url,
        target: &Url,
        user_agent: &[u8],
        identity: Option<Identity>,
        address: Option<[u8; 4]>,
    ) -> Tunnel {
        Tunnel {
            proxy: proxy.clone(),
            target: target.clone(),
            user_agent: user_agent.into(),
            identity,
            address,
            handshake: None,
            next_login: Vec::new(),
            stage: Stage::ConnectReply,
            received: Vec::new(),
            refusal: None,
        }
    }

    /// To the target itself.
    pub(super) fn direct(target: &Url) -> Tunnel {
        Tunnel {
            stage: Stage::Direct,
            ..Tunnel::new(target, target, b"", None, None)
        }
    }

    fn port(&self) -> u16 {
        self.target.port_or_default().unwrap_or(80)
    }

    fn authority(&self) -> Vec<u8> {
        [
            self.target.hostname(),
            format!(":{}", self.port()).as_bytes(),
        ]
        .concat()
    }

    fn write_connect(&self, login: Option<&[u8]>, to_send: &mut Vec<u8>) {
        let authority = self.authority();
        to_send.extend(
            [
                b"CONNECT ",
                &*authority,
                b" HTTP/1.1\r\nHost: ",
                &authority,
                b"\r\nProxy-Connection: keep-alive\r\n",
            ]
            .concat(),
        );
        for (name, value) in [
            (&b"User-Agent: "[..], &*self.user_agent),
            (b"Proxy-Authorization: ", login.unwrap_or_default()),
        ] {
            if !value.is_empty() {
                to_send.extend([name, value, b"\r\n"].concat());
            }
        }
        to_send.extend(b"\r\n");
    }

    fn refuse(&mut self, refusal: Refusal) -> Step {
        self.refusal = Some(refusal);
        Step::Failed
    }

    fn start(&mut self, to_send: &mut Vec<u8>) -> Step {
        if let Stage::Direct = self.stage {
            return Step::Done(0);
        }
        self.stage = match self.proxy.scheme() {
            b"socks5" => {
                to_send.extend([5, 1, 0]);
                Stage::Socks5Method
            }
            _ if is_socks(&self.proxy) => {
                let Some(address) = self.address else {
                    return self.refuse(Refusal::Error(NetError::NameNotResolved));
                };
                to_send.extend([&[4, 1][..], &self.port().to_be_bytes(), &address, &[0]].concat());
                Stage::Socks4Reply
            }
            _ => {
                let (authority, peer) = (
                    self.authority(),
                    Peer {
                        hostname: self.proxy.hostname(),
                        certificate: b"",
                        may_act_as_user: false,
                    },
                );
                self.handshake = self.identity.clone().map(Handshake::new);
                let login = self
                    .handshake
                    .as_mut()
                    .and_then(|it| it.start(b"CONNECT", &authority, &peer));
                self.write_connect(login.as_deref(), to_send);
                Stage::ConnectReply
            }
        };
        Step::GoesOn(0)
    }

    fn read_connect_reply(&mut self, received: &[u8], to_send: &mut Vec<u8>) -> Step {
        let options = HeadOptions {
            max_len: 256 << 10,
            max_headers: usize::MAX,
            max_interim_len: usize::MAX,
            spare_capacity: 0,
        };
        let (reply, length) =
            match ResponseParser::default().feed_leniently(received, options, |_| {}) {
                Ok(Some((reply, rest))) => (reply, received.len() - rest.len()),
                Ok(None) => return Step::GoesOn(0),
                Err(_) => return Step::Failed,
            };
        if reply.status_code != 407 {
            return if reply.status_code == 200 {
                Step::Done(length)
            } else {
                Step::Failed
            };
        }
        let headers: HeaderList = reply
            .headers
            .iter()
            .map(|it| (it.name(), it.value()))
            .collect();
        let peer = Peer {
            hostname: self.proxy.hostname(),
            certificate: b"",
            may_act_as_user: false,
        };
        let login = self.handshake.as_mut().and_then(|it| {
            it.go_on(
                &Challenge::parse_all(headers.values(b"proxy-authenticate")),
                &peer,
            )
        });
        match (login, browser::content_length(&reply.headers)) {
            (Some(login), Ok(Some(of_body))) => {
                self.next_login = login;
                self.skip(length.saturating_add(of_body), received, to_send)
            }
            (Some(_), _) => Step::Failed,
            (None, _) => self.refuse(Refusal::Challenge(headers)),
        }
    }

    fn skip(&mut self, left: usize, received: &[u8], to_send: &mut Vec<u8>) -> Step {
        if left > received.len() {
            self.stage = Stage::Skipping(left - received.len());
            return Step::GoesOn(received.len());
        }
        self.write_connect(Some(&self.next_login), to_send);
        self.stage = Stage::ConnectReply;
        Step::GoesOn(left)
    }

    pub(super) fn negotiate(&mut self, more: Option<&[u8]>) -> Negotiation {
        let (mut received, mut to_send) = (core::mem::take(&mut self.received), Vec::new());
        let step = if let Some(more) = more {
            received.extend_from_slice(more);
            self.read(&received, &mut to_send)
        } else {
            received.clear();
            self.start(&mut to_send)
        };
        match step {
            Step::GoesOn(read) => {
                self.received = received.split_off(read);
                Negotiation::Send(to_send)
            }
            Step::Done(read) => Negotiation::Done(received.split_off(read)),
            Step::Failed => Negotiation::Failed,
        }
    }

    fn read(&mut self, received: &[u8], to_send: &mut Vec<u8>) -> Step {
        let if_complete = |length| {
            if received.len() < length {
                Step::GoesOn(0)
            } else {
                Step::Done(length)
            }
        };
        match (self.stage, received) {
            (Stage::ConnectReply, _) => self.read_connect_reply(received, to_send),
            (Stage::Skipping(left), _) => self.skip(left, received, to_send),
            (Stage::Socks4Reply, [0] | [0, 0x5a, ..]) => if_complete(8),
            (Stage::Socks5Method, [5])
            | (Stage::Socks5Reply, [5] | [5, 0] | [5, 0, 0] | [5, 0, 0, _]) => Step::GoesOn(0),
            (Stage::Socks5Method, [5, 0]) if self.target.hostname().len() < 256 => {
                let name = bun_core::strings::trim(self.target.hostname(), b"[]");
                to_send.extend(
                    [
                        &[5, 1, 0, 3, name.len() as u8][..],
                        name,
                        &self.port().to_be_bytes(),
                    ]
                    .concat(),
                );
                self.stage = Stage::Socks5Reply;
                Step::GoesOn(2)
            }
            (Stage::Socks5Reply, [5, 0, 0, 1, ..]) => if_complete(10),
            (Stage::Socks5Reply, [5, 0, 0, 3, length, ..]) => if_complete(7 + usize::from(*length)),
            (Stage::Socks5Reply, [5, 0, 0, 4, ..]) => if_complete(22),
            (Stage::Socks5Reply, [5, 4, ..]) => {
                self.refuse(Refusal::Error(NetError::SocksConnectionHostUnreachable))
            }
            _ => self.refuse(Refusal::Error(NetError::SocksConnectionFailed)),
        }
    }
}
