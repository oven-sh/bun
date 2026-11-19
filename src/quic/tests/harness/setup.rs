use super::raw::Raw;
use super::tls::{TICKET, message};
use super::wire::{hex, show_hex};

impl Raw {
    /// RFC 9000 §17.2.1.
    pub(crate) fn version_negotiation(&self, versions: &str) -> Vec<u8> {
        let ids = [&self.destination, &self.original];
        let ids = ids.map(|id| [&[id.len() as u8], &id[..]].concat());
        [hex("8000000000"), ids.concat(), hex(versions)].concat()
    }

    pub(crate) fn versions_of_packets(&mut self) -> Vec<u32> {
        self.take().iter().map(|it| it.version).collect()
    }

    /// For a server. The client is expected to follow.
    pub(crate) fn send_retry(&mut self, token: &[u8]) {
        let source = std::mem::replace(&mut self.source, b"retry-id".to_vec());
        let packet = self.retry(token);
        self.retry_source = Some(std::mem::replace(&mut self.source, source));
        self.deliver(&packet);
    }

    /// For a second connection, with the ticket from the first one.
    pub(crate) fn with_ticket(self) -> Self {
        let mut raw = self.config(|it| it.wants_tickets = true).connected();
        let ticket = if raw.side.is_client() {
            raw.peer_ticket()
        } else {
            let ticket = show_hex(&message(TICKET, &[b"session"]));
            raw.send(&format!("crypto 0 {ticket}"));
            raw.peer.tickets.remove(0)
        };
        raw.connection().abort_silently();
        raw.forget();
        let version = raw.version;
        raw = raw.again();
        (raw.version, raw.ticket, raw.accepts_early_data) = (version, ticket, true);
        raw
    }

    pub(crate) fn resume(&mut self) {
        self.start(&self.ticket.clone());
    }

    /// From now on, the packets are those of another client, which has this port.
    pub(crate) fn act_as(&mut self, port: u16) {
        self.addresses.peer.set_port(port);
        self.original = u64::from(port).to_be_bytes().to_vec();
        self.destination.clone_from(&self.original);
    }
}
