use bun_quic::Side;
use bun_quic::crypto::Cipher;
use bun_quic::tls::{Alert, Handshake, Level, Session, Status};

pub(crate) const CLIENT_HELLO: u8 = 1;
pub(crate) const SERVER_HELLO: u8 = 2;
pub(crate) const TICKET: u8 = 4;
const END_OF_EARLY_DATA: u8 = 5;
pub(crate) const EXTENSIONS: u8 = 8;
pub(crate) const CERTIFICATE: u8 = 11;
pub(crate) const FINISHED: u8 = 20;

#[derive(Clone, Copy)]
pub(crate) struct Options {
    pub(crate) cipher: Cipher,
    /// What is added to the first message.
    pub(crate) hello_len: usize,
    pub(crate) certificate_len: usize,
    pub(crate) tickets: usize,
    pub(crate) resumes: bool,
    pub(crate) uses_early_data: bool,
    pub(crate) logs_keys: bool,
    pub(crate) fails_to_start: bool,
    /// RFC 8446 §4.1.4.
    pub(crate) asks_for_another_hello: bool,
    pub(crate) rejects_peer_with: Option<Alert>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            cipher: Cipher::Aes128GcmSha256,
            hello_len: 200,
            certificate_len: 600,
            tickets: 1,
            resumes: true,
            uses_early_data: true,
            logs_keys: false,
            fails_to_start: false,
            asks_for_another_hello: false,
            rejects_peer_with: None,
        }
    }
}

/// Has the order of messages and calls of BoringSSL.
pub(crate) struct Toy {
    side: Side,
    options: Options,
    random: u8,
    ticket: Vec<u8>,
    is_early: bool,
    peer_parameters: Vec<u8>,
    input: Vec<u8>,
    is_complete: bool,
}

impl Toy {
    pub(crate) fn new(side: Side, random: u8, options: Options) -> Box<Self> {
        Box::new(Self {
            side,
            options,
            random,
            ticket: Vec::new(),
            is_early: false,
            peer_parameters: Vec::new(),
            input: Vec::new(),
            is_complete: false,
        })
    }
}

/// `random` is that of the client.
pub(crate) fn secret(cipher: Cipher, random: u8, level: Level, sender: Side) -> Vec<u8> {
    let len = if cipher == Cipher::Aes256GcmSha384 {
        48
    } else {
        32
    };
    [vec![level as u8, sender as u8], vec![random; len - 2]].concat()
}

pub(crate) fn message(kind: u8, parts: &[&[u8]]) -> Vec<u8> {
    let body: Vec<u8> = (parts.iter())
        .flat_map(|part| [&(part.len() as u16).to_be_bytes(), *part].concat())
        .collect();
    [&[kind], &(body.len() as u32).to_be_bytes()[1..], &body].concat()
}

/// Takes a message if it is complete.
pub(crate) fn next_message<'a>(input: &mut &'a [u8]) -> Option<(u8, Vec<&'a [u8]>)> {
    let (&[kind, a, b, c], rest) = input.split_first_chunk()?;
    let (mut body, rest) = rest.split_at_checked(u32::from_be_bytes([0, a, b, c]) as usize)?;
    *input = rest;
    let parts = std::iter::from_fn(|| {
        let len = body.split_off(..2)?;
        body.split_off(..usize::from(u16::from_be_bytes([len[0], len[1]])))
    });
    Some((kind, parts.collect()))
}

impl Toy {
    fn write_secret(&self, level: Level, handshake: &mut Handshake<'_>) {
        let cipher = self.options.cipher;
        let secret = secret(cipher, self.random, level, self.side);
        handshake.write_secret(level, cipher, &secret);
        if self.options.logs_keys {
            handshake.key_log(format!("{level:?}").as_bytes());
        }
    }

    fn read_secret(&self, level: Level, handshake: &mut Handshake<'_>) {
        let cipher = self.options.cipher;
        let secret = secret(cipher, self.random, level, !self.side);
        handshake.read_secret(level, cipher, &secret);
    }

    fn send_hello(&self, handshake: &mut Handshake<'_>) {
        let parts = [
            &[self.random][..],
            &handshake.local_parameters(),
            &self.ticket,
            handshake.version().http3_alpn(),
            &vec![0; self.options.hello_len],
        ];
        handshake.send(Level::Initial, &message(CLIENT_HELLO, &parts));
    }

    fn handle(
        &mut self,
        level: Level,
        kind: u8,
        parts: &[&[u8]],
        handshake: &mut Handshake<'_>,
    ) -> Result<(), Alert> {
        match (self.side, level, kind, parts) {
            (Side::Server, Level::Initial, CLIENT_HELLO, [[random], peer, ticket, alpn, _]) => {
                self.random = *random;
                self.ticket = [b"ticket", &handshake.early_data_context()[..]].concat();
                let is_first =
                    self.peer_parameters.is_empty() && !self.options.asks_for_another_hello;
                let is_early = is_first && self.options.uses_early_data && *ticket == self.ticket;
                if *alpn != handshake.version().http3_alpn() {
                    return Err(Alert(120));
                }
                self.options.rejects_peer_with.map_or(Ok(()), Err)?;
                if self.peer_parameters.is_empty() && !handshake.peer_parameters(peer, is_early) {
                    return Err(Alert::INTERNAL_ERROR);
                }
                self.peer_parameters = peer.to_vec();
                if std::mem::take(&mut self.options.asks_for_another_hello) {
                    handshake.send(Level::Initial, &message(SERVER_HELLO, &[]));
                    return Ok(());
                }
                let parameters = handshake.local_parameters();
                let hello = message(SERVER_HELLO, &[&vec![0; self.options.hello_len]]);
                handshake.send(Level::Initial, &hello);
                self.write_secret(Level::Handshake, handshake);
                for message in [
                    message(EXTENSIONS, &[&parameters, &[is_early.into()]]),
                    message(CERTIFICATE, &[&vec![7; self.options.certificate_len]]),
                    message(FINISHED, &[]),
                ] {
                    handshake.send(Level::Handshake, &message);
                }
                self.write_secret(Level::Application, handshake);
                if is_early {
                    self.read_secret(Level::EarlyData, handshake);
                }
                self.read_secret(Level::Handshake, handshake);
            }
            (Side::Server, Level::Handshake, FINISHED, []) => {
                self.read_secret(Level::Application, handshake);
                let tickets = message(TICKET, &[&self.ticket]).repeat(self.options.tickets);
                handshake.send(Level::Application, &tickets);
                self.is_complete = true;
            }
            (Side::Client, Level::Initial, SERVER_HELLO, []) => {
                if std::mem::take(&mut self.is_early) {
                    handshake.early_data_rejected();
                }
                self.send_hello(handshake);
            }
            (Side::Client, Level::Initial, SERVER_HELLO, [_]) => {
                self.write_secret(Level::Handshake, handshake);
                self.read_secret(Level::Handshake, handshake);
            }
            (Side::Client, Level::Handshake, EXTENSIONS, [parameters, [is_early]]) => {
                if self.is_early && *is_early == 0 {
                    handshake.early_data_rejected();
                }
                self.peer_parameters = parameters.to_vec();
            }
            (Side::Client, Level::Handshake, CERTIFICATE, [_]) => {
                self.options.rejects_peer_with.map_or(Ok(()), Err)?;
            }
            (Side::Client, Level::Handshake, FINISHED, []) => {
                handshake.send(Level::Handshake, &message(FINISHED, &[]));
                self.write_secret(Level::Application, handshake);
                self.read_secret(Level::Application, handshake);
                if !handshake.peer_parameters(&self.peer_parameters, false) {
                    return Err(Alert::INTERNAL_ERROR);
                }
                self.is_complete = true;
            }
            (Side::Client, Level::Application, TICKET, [ticket]) => handshake.ticket(ticket),
            (_, _, END_OF_EARLY_DATA, _) => {
                handshake.violation();
                return Err(Alert(10));
            }
            _ => return Err(Alert(10)),
        }
        Ok(())
    }
}

impl Session for Toy {
    fn resume(&mut self, ticket: &[u8]) -> bool {
        if self.options.resumes {
            self.ticket = ticket.to_vec();
        }
        self.options.resumes
    }

    fn advance(
        &mut self,
        input: Option<(Level, &[u8])>,
        handshake: &mut Handshake<'_>,
    ) -> Result<Status, Alert> {
        let Some((level, data)) = input else {
            if self.options.fails_to_start {
                return Err(Alert::INTERNAL_ERROR);
            }
            self.send_hello(handshake);
            self.is_early = self.options.uses_early_data && !self.ticket.is_empty();
            if self.is_early {
                self.write_secret(Level::EarlyData, handshake);
            }
            return Ok(Status::InProgress);
        };
        let input = [&self.input, data].concat();
        if level == Level::Application && input.len() > 16 * 1024 {
            return Err(Alert::INTERNAL_ERROR);
        }
        let mut rest = &input[..];
        while let Some((kind, parts)) = next_message(&mut rest) {
            self.handle(level, kind, &parts, handshake)?;
        }
        self.input = rest.to_vec();
        Ok(match self.is_complete {
            true => Status::Complete,
            false => Status::InProgress,
        })
    }
}
