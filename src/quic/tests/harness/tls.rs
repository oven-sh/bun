use bun_quic::Side;
use bun_quic::crypto::Cipher;
use bun_quic::tls::{Alert, Handshake, Level, Session, Status};

const CIPHER: Cipher = Cipher::Aes128GcmSha256;
const CLIENT_HELLO: u8 = 1;
const SERVER_HELLO: u8 = 2;
const TICKET: u8 = 4;
const EXTENSIONS: u8 = 8;
const CERTIFICATE: u8 = 11;
const FINISHED: u8 = 20;

#[derive(Clone, Copy)]
pub(crate) struct Options {
    /// What is added to the first message.
    pub(crate) hello_len: usize,
    pub(crate) certificate_len: usize,
    pub(crate) accepts_early_data: bool,
    pub(crate) rejects_peer_with: Option<Alert>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            hello_len: 200,
            certificate_len: 1000,
            accepts_early_data: true,
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
    context: Vec<u8>,
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
            context: Vec::new(),
            input: Vec::new(),
            is_complete: false,
        })
    }
}

pub(crate) fn secret(random: u8, level: Level, sender: Side) -> [u8; 32] {
    let mut secret = [random; 32];
    secret[0] = level as u8;
    secret[1] = sender as u8;
    secret
}

pub(crate) fn message(kind: u8, parts: &[&[u8]]) -> Vec<u8> {
    let body: Vec<u8> = (parts.iter())
        .flat_map(|part| [&(part.len() as u16).to_be_bytes(), *part].concat())
        .collect();
    [&[kind], &(body.len() as u32).to_be_bytes()[1..], &body].concat()
}

fn parts(mut body: &[u8]) -> Result<Vec<&[u8]>, Alert> {
    let mut parts = Vec::new();
    while let Some(len) = body.split_off(..2) {
        let len = usize::from(u16::from_be_bytes([len[0], len[1]]));
        parts.push(body.split_off(..len).ok_or(Alert(50))?);
    }
    Ok(parts)
}

impl Toy {
    fn set_secrets(&self, level: Level, handshake: &mut Handshake<'_>) {
        handshake.write_secret(level, CIPHER, &secret(self.random, level, self.side));
        handshake.read_secret(level, CIPHER, &secret(self.random, level, !self.side));
    }

    fn handle(
        &mut self,
        level: Level,
        kind: u8,
        body: &[u8],
        handshake: &mut Handshake<'_>,
    ) -> Result<(), Alert> {
        match (self.side, level, kind, &parts(body)?[..]) {
            (Side::Server, Level::Initial, CLIENT_HELLO, [[random], parameters, ticket, _]) => {
                self.random = self.random.wrapping_add(*random);
                let is_early = !ticket.is_empty()
                    && self.options.accepts_early_data
                    && *ticket == self.context;
                if let Some(alert) = self.options.rejects_peer_with {
                    return Err(alert);
                }
                if !handshake.peer_parameters(parameters, is_early) {
                    return Err(Alert::INTERNAL_ERROR);
                }
                let parameters = handshake.local_parameters();
                let padding = vec![0; self.options.hello_len];
                let hello = message(SERVER_HELLO, &[&[self.random], &padding]);
                handshake.send(Level::Initial, &hello);
                self.set_secrets(Level::Handshake, handshake);
                let certificate = vec![7; self.options.certificate_len];
                for message in [
                    message(EXTENSIONS, &[&parameters, &[is_early.into()]]),
                    message(CERTIFICATE, &[&certificate]),
                    message(FINISHED, &[]),
                ] {
                    handshake.send(Level::Handshake, &message);
                }
                let write = secret(self.random, Level::Application, Side::Server);
                handshake.write_secret(Level::Application, CIPHER, &write);
                if is_early {
                    let read = secret(*random, Level::EarlyData, Side::Client);
                    handshake.read_secret(Level::EarlyData, CIPHER, &read);
                }
            }
            (Side::Server, Level::Handshake, FINISHED, []) => {
                let read = secret(self.random, Level::Application, Side::Client);
                handshake.read_secret(Level::Application, CIPHER, &read);
                handshake.send(Level::Application, &message(TICKET, &[&self.context]));
                self.is_complete = true;
            }
            (Side::Client, Level::Initial, SERVER_HELLO, [[random], _]) => {
                self.random = *random;
                self.set_secrets(Level::Handshake, handshake);
            }
            (Side::Client, Level::Handshake, EXTENSIONS, [parameters, [is_early]]) => {
                if !self.ticket.is_empty() && *is_early == 0 {
                    handshake.early_data_rejected();
                }
                self.context = parameters.to_vec();
            }
            (Side::Client, Level::Handshake, CERTIFICATE, [_]) => {
                if let Some(alert) = self.options.rejects_peer_with {
                    return Err(alert);
                }
            }
            (Side::Client, Level::Handshake, FINISHED, []) => {
                handshake.send(Level::Handshake, &message(FINISHED, &[]));
                self.set_secrets(Level::Application, handshake);
                if !handshake.peer_parameters(&self.context, false) {
                    return Err(Alert::INTERNAL_ERROR);
                }
                self.is_complete = true;
            }
            (Side::Client, Level::Application, TICKET, [ticket]) => handshake.ticket(ticket),
            _ => return Err(Alert(10)),
        }
        Ok(())
    }
}

impl Session for Toy {
    fn resume(&mut self, ticket: &[u8]) -> bool {
        self.ticket = ticket.to_vec();
        true
    }

    fn set_early_data_context(&mut self, context: &[u8]) {
        self.context = context.to_vec();
    }

    fn advance(
        &mut self,
        input: Option<(Level, &[u8])>,
        handshake: &mut Handshake<'_>,
    ) -> Result<Status, Alert> {
        let Some((level, data)) = input else {
            let (parameters, padding) = (
                handshake.local_parameters(),
                vec![0; self.options.hello_len],
            );
            let parts = [&[self.random][..], &parameters, &self.ticket, &padding];
            handshake.send(Level::Initial, &message(CLIENT_HELLO, &parts));
            if !self.ticket.is_empty() {
                let write = secret(self.random, Level::EarlyData, Side::Client);
                handshake.write_secret(Level::EarlyData, CIPHER, &write);
            }
            return Ok(Status::InProgress);
        };
        self.input.extend_from_slice(data);
        while let [kind, a, b, c, ref rest @ ..] = self.input[..]
            && let Some(body) = rest.get(..u32::from_be_bytes([0, a, b, c]) as usize)
        {
            let body = body.to_vec();
            self.input.drain(..4 + body.len());
            self.handle(level, kind, &body, handshake)?;
        }
        Ok(match self.is_complete {
            true => Status::Complete,
            false => Status::InProgress,
        })
    }
}
