//! <https://w3c.github.io/ServiceWorker/#dfn-list-of-router-rules>

use crate::Bytes;
use crate::net::record::{RecordReader, RecordWriter};
use crate::request::{Destination, Mode, Request};
use crate::url_pattern::UrlPattern;

pub const MOST_CONDITIONS: usize = 1024;
pub const DEEPEST_CONDITION: usize = 10;

keywords! {
    #[derive(Default)]
    pub enum Route {
        #[default]
        None = b"",
        Cache = b"cache",
        FetchEvent = b"fetch-event",
        Network = b"network",
        Race = b"race-network-and-fetch-handler",
    }
}

pub enum Condition {
    All {
        pattern: Option<Box<UrlPattern>>,
        method: Option<Bytes>,
        mode: Option<Mode>,
        destination: Option<Destination>,
        is_running: Option<bool>,
    },
    Any(Vec<Condition>),
    Not(Box<Condition>),
}

pub struct Rule {
    pub condition: Condition,
    pub route: Route,
    /// Encoded like a key.
    pub cache_name: Option<Vec<u8>>,
}

impl Condition {
    pub(super) fn count(&self) -> usize {
        1 + match self {
            Condition::All { .. } => 0,
            Condition::Any(all) => all.iter().map(Condition::count).sum(),
            Condition::Not(it) => it.count(),
        }
    }

    pub(super) fn holds(&self, request: &Request, runs: bool, steps: &mut usize) -> bool {
        match self {
            Condition::All {
                pattern,
                method,
                mode,
                destination,
                is_running,
            } => {
                method.as_ref().is_none_or(|it| *it == request.method)
                    && mode.is_none_or(|it| it == request.mode)
                    && destination.is_none_or(|it| it == request.destination)
                    && is_running.is_none_or(|it| it == runs)
                    && (pattern.as_ref()).is_none_or(|it| it.matches(&request.url, steps))
            }
            Condition::Any(all) => all.iter().any(|it| it.holds(request, runs, steps)),
            Condition::Not(it) => !it.holds(request, runs, steps),
        }
    }

    fn write(&self, out: &mut RecordWriter) {
        match self {
            Condition::All {
                pattern,
                method,
                mode,
                destination,
                is_running,
            } => {
                out.count(0);
                for it in [
                    method.as_deref(),
                    mode.map(Mode::as_bytes),
                    destination.map(Destination::as_bytes),
                ] {
                    out.optional(it);
                }
                out.count(is_running.map_or(2, usize::from));
                out.count(pattern.is_some().into());
                pattern.iter().for_each(|it| it.write(out));
            }
            Condition::Any(all) => {
                out.count(1);
                out.count(all.len());
                all.iter().for_each(|it| it.write(out));
            }
            Condition::Not(it) => {
                out.count(2);
                it.write(out);
            }
        }
    }

    fn read(it: &mut RecordReader<'_>, depth: usize) -> Option<Condition> {
        Some(match it.count().filter(|_| depth <= DEEPEST_CONDITION)? {
            0 => Condition::All {
                method: it.optional()?.map(Into::into),
                mode: it.optional()?.and_then(Mode::parse),
                destination: it.optional()?.and_then(Destination::parse),
                is_running: Some(it.count()?).filter(|it| *it < 2).map(|it| it == 1),
                pattern: match it.count()? {
                    0 => None,
                    _ => Some(UrlPattern::read(it)?.into()),
                },
            },
            1 => Condition::Any(it.list(|it| Condition::read(it, depth + 1))?),
            _ => Condition::Not(Condition::read(it, depth + 1)?.into()),
        })
    }
}

impl Rule {
    pub(super) fn write(&self, out: &mut RecordWriter) {
        out.bytes(self.route.as_bytes());
        out.optional(self.cache_name.as_deref());
        self.condition.write(out);
    }

    pub(super) fn read(it: &mut RecordReader<'_>) -> Option<Rule> {
        Some(Rule {
            route: Route::parse(it.bytes()?)?,
            cache_name: it.optional()?.map(Into::into),
            condition: Condition::read(it, 1)?,
        })
    }
}
