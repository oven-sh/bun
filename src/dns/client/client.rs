use core::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use core::time::Duration;
use std::collections::VecDeque;
use std::rc::Rc;

use crate::Error;
use crate::cache::Cache;
use crate::config::{Config, port_or_default};
use crate::hosts::Hosts;
use crate::lookup::{AddressLookup, NameLookup, answer_without_query};
use crate::message::{Address, Message, Question, RecordType, Records};
use crate::servers::{ServerId, Servers};
use crate::system::{Events, SocketId, System, Transport};
use crate::transport::{Connections, MIN_TIMEOUT, Queries};

/// The least time between reloads once the system names a server: reading the configuration can take long.
const RELOAD_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Clone, Copy)]
pub struct Options {
    /// Of the first try at a server that has yet to show how long it takes. `None`: what the system says.
    pub timeout: Option<Duration>,
    /// Of any try.
    pub max_timeout: Option<Duration>,
    /// For each server.
    pub tries: u32,
}

pub enum Reply {
    Records(Records),
    Addresses(Vec<Address>),
    Names(Vec<Box<[u8]>>),
    NameInfo {
        host: Box<[u8]>,
        /// `None` for port 0.
        service: Option<Box<[u8]>>,
    },
}

pub type Answer = Result<Reply, Error>;

/// The requests that a call finished, in the order it finished them.
pub type Answers<R> = Vec<(R, Answer)>;

/// What a question is asked for.
pub(crate) enum Purpose<R> {
    Records(R),
    Addresses(Rc<AddressLookup<R>>, RecordType),
    Names(NameLookup<R>),
}

pub(crate) type Outcome = Result<Message, Error>;

/// What waits until the sockets and the deadlines have been gone through.
pub(crate) enum Step<R> {
    /// `Some`: to see whether this one, which failed, is back.
    Send(Question, Option<(ServerId, Transport)>),
    /// The error is the outcome if there is no try left. `None`: that of the try before.
    Retry(Question, Option<Error>),
    /// For all that wait for the reply.
    End(Question, Outcome),
    Finish(Purpose<R>, Outcome),
}

/// A request carries an `R`, which comes back with its answer.
pub struct Client<S: System, R> {
    pub(crate) system: S,
    pub(crate) config: Config,
    /// Until [`set_servers`](Self::set_servers).
    uses_system_servers: bool,
    /// The last query timed out or was refused. The machine may have moved to another network.
    pub(crate) needs_reload: bool,
    reload_at: Duration,
    timeout_option: Option<Duration>,
    pub(crate) max_timeout: Option<Duration>,
    pub(crate) tries: usize,
    pub(crate) servers: Servers,
    pub(crate) local_v4: Option<Ipv4Addr>,
    pub(crate) local_v6: Option<Ipv6Addr>,
    /// Of the hashes of questions.
    seed: u64,
    pub(crate) cache: Cache,
    pub(crate) hosts: Hosts,
    pub(crate) queries: Queries<R>,
    pub(crate) connections: Connections<S::Socket>,
    /// When the current call started.
    pub(crate) now: Duration,
    /// Empty between calls, as is `answers`.
    pub(crate) steps: VecDeque<Step<R>>,
    answers: Answers<R>,
}

fn load_config(system: &mut impl System, timeout: Option<Duration>) -> Config {
    let mut config = Config::load(system);
    config.timeout = timeout.or(config.timeout).map(|it| it.max(MIN_TIMEOUT));
    config
}

impl<S: System, R> Client<S, R> {
    pub fn new(mut system: S, options: Options) -> Self {
        let mut config = load_config(&mut system, options.timeout);
        let mut servers = Servers::default();
        servers.replace(core::mem::take(&mut config.servers).into_iter());
        let seed = (0..4).try_fold(0, |seed, _| Some(seed << 16 | u64::from(system.random()?)));
        let seed = seed.unwrap_or_else(|| system.now().as_nanos() as u64);
        Self {
            system,
            config,
            uses_system_servers: true,
            needs_reload: false,
            reload_at: Duration::ZERO,
            timeout_option: options.timeout,
            max_timeout: options.max_timeout,
            tries: options.tries as usize,
            servers,
            local_v4: None,
            local_v6: None,
            seed,
            cache: Cache::default(),
            hosts: Hosts::default(),
            queries: Queries::new(),
            connections: Connections::default(),
            now: Duration::ZERO,
            steps: VecDeque::new(),
            answers: Vec::new(),
        }
    }

    /// Whether one is still to be answered.
    pub fn has_requests(&self) -> bool {
        !self.queries.is_empty()
    }

    /// Best first.
    pub fn servers(&self) -> impl ExactSizeIterator<Item = SocketAddr> {
        self.servers.iter().map(|server| server.address)
    }

    /// Whether [`lookup`](Self::lookup) may send a query, and neither the system nor [`set_servers`](Self::set_servers) named a server.
    pub fn uses_default_server_for(&self, host: &[u8]) -> bool {
        self.uses_system_servers
            && !self.config.has_nameserver
            && answer_without_query(host).is_none()
    }

    /// Port 0 is the default one.
    #[must_use]
    pub fn set_servers(&mut self, servers: &[(IpAddr, u16)]) -> Answers<R> {
        self.uses_system_servers = false;
        self.call(|this| {
            let address = |&(ip, port)| SocketAddr::new(ip, port_or_default(port));
            this.servers.replace(servers.iter().map(address));
            this.cache = Cache::default();
            this.leave_removed_servers();
            this.send_held_back();
        })
    }

    /// What new sockets of the family of `ip` are bound to.
    pub fn set_local_ip(&mut self, ip: IpAddr) {
        self.cache = Cache::default();
        match ip {
            IpAddr::V4(ip) => self.local_v4 = Some(ip).filter(|ip| !ip.is_unspecified()),
            IpAddr::V6(ip) => self.local_v6 = Some(ip).filter(|ip| !ip.is_unspecified()),
        }
    }

    /// Asks for `name` as it is: no hosts file, no search list.
    #[must_use]
    pub fn resolve(&mut self, kind: RecordType, name: &[u8], request: R) -> Answers<R> {
        self.start_request(|this| this.ask(name, kind, Purpose::Records(request)))
    }

    #[must_use]
    pub fn process(&mut self, socket: SocketId, events: Events) -> Answers<R> {
        self.call(|this| {
            this.read_and_write(socket, events);
            this.time_out();
            this.send_held_back();
        })
    }

    #[must_use]
    pub fn process_timeouts(&mut self) -> Answers<R> {
        self.call(|this| {
            this.make_room();
            this.time_out_if_due();
            this.send_held_back();
        })
    }

    #[must_use]
    pub fn cancel(&mut self) -> Answers<R> {
        self.call(|this| this.fail_all(Error::ECANCELLED))
    }

    #[must_use]
    pub fn close(mut self) -> Answers<R> {
        self.call(|this| this.fail_all(Error::EDESTRUCTION))
    }

    /// As [`call`](Self::call), after a reload if one is due.
    pub(crate) fn start_request(&mut self, start: impl FnOnce(&mut Self)) -> Answers<R> {
        self.call(|this| {
            if this.needs_reload && this.uses_system_servers && this.reload_at <= this.now {
                this.reload();
            }
            start(this);
        })
    }

    /// https://github.com/nodejs/node/blob/v26.12.1/src/cares_wrap.cc#L985-L1040, for any servers and without ending outstanding queries.
    #[cold]
    fn reload(&mut self) {
        self.needs_reload = false;
        let mut config = load_config(&mut self.system, self.timeout_option);
        match (config.has_nameserver, self.config.has_nameserver) {
            (true, _) => {
                let servers = core::mem::take(&mut config.servers);
                if self.servers.replace(servers.into_iter()) {
                    self.cache = Cache::default();
                }
                self.leave_removed_servers();
                self.config = config;
            }
            // There may have been no file descriptor to read it with.
            (false, true) => {}
            (false, false) => {
                self.config = config;
                return;
            }
        }
        self.reload_at = self.now.saturating_add(RELOAD_INTERVAL);
    }

    fn call(&mut self, start: impl FnOnce(&mut Self)) -> Answers<R> {
        self.now = self.system.now();
        start(self);
        self.take_steps();
        self.close_idle();
        core::mem::take(&mut self.answers)
    }

    pub(crate) fn take_steps(&mut self) {
        while let Some(step) = self.steps.pop_front() {
            match step {
                Step::Send(question, probed) => self.send(question, probed),
                Step::Retry(question, error) => self.retry(question, error),
                Step::End(question, outcome) => self.end(&question, &outcome),
                Step::Finish(purpose, outcome) => self.finish(purpose, outcome),
            }
        }
    }

    pub(crate) fn answer(&mut self, request: R, answer: Answer) {
        self.answers.push((request, answer));
    }

    pub(crate) fn ask(&mut self, name: &[u8], kind: RecordType, purpose: Purpose<R>) {
        let outcome = match Question::new(name, kind, self.seed) {
            Ok(question) => match self.cache.get(&question, self.now, &self.system) {
                Some(message) => Ok(message),
                None => return self.join_or_send(question, purpose),
            },
            Err(error) => Err(error),
        };
        self.steps.push_back(Step::Finish(purpose, outcome));
    }

    pub(crate) fn finish(&mut self, purpose: Purpose<R>, outcome: Outcome) {
        match purpose {
            Purpose::Records(request) => {
                let records = outcome.and_then(Message::into_records);
                self.answer(request, records.map(Reply::Records));
            }
            Purpose::Addresses(lookup, kind) => self.got_addresses(lookup, kind, outcome),
            Purpose::Names(lookup) => self.got_names(lookup, outcome),
        }
    }
}
