//! https://www.rfc-editor.org/rfc/rfc6797

use std::sync::Arc;

use bun_collections::HashMap;
use bun_core::{ZBox, strings};
use bun_sha_hmac::sha::evp::SHA256;
use bun_sys::{Fd, File, O};
use bun_threading::Guarded;

use super::record::{RecordReader, RecordWriter};
use crate::headers::{collect_quoted, digits, split};
use crate::time::wall_now;
use crate::url::Url;
use crate::{Bytes, exec};

const FORMAT: &[u8] = b"hsts 1";

#[derive(Clone, Copy)]
struct Policy {
    expires: f64,
    includes_subdomains: bool,
}

/// The names are not on the disk.
type Hosts = HashMap<[u8; 32], Policy>;

pub(super) struct Hsts {
    file: Option<Bytes>,
    hosts: Arc<Guarded<Option<Hosts>>>,
}

fn key_of(host: &[u8]) -> [u8; 32] {
    let mut key = [0; 32];
    SHA256::hash(strings::trim_right(host, b"."), &mut key);
    key
}

fn parse(value: &[u8]) -> Option<(u64, bool)> {
    let (mut age, mut includes_subdomains) = (None, false);
    for directive in split(value, b';') {
        let (name, value) = strings::split_once_char(directive, b'=')
            .map_or((directive, None), |it| {
                (it.0.trim_ascii(), Some(it.1.trim_ascii()))
            });
        if name.eq_ignore_ascii_case(b"max-age") {
            let value = value.filter(|_| age.is_none())?;
            age = Some(if value.starts_with(b"\"") {
                digits(&collect_quoted(value).0)
            } else {
                digits(value)
            }?);
        } else if name.eq_ignore_ascii_case(b"includesubdomains") {
            (value.is_none() && !includes_subdomains).then_some(())?;
            includes_subdomains = true;
        }
    }
    Some((age?, includes_subdomains))
}

fn read(file: &[u8]) -> Option<Hosts> {
    let bytes = File::read_from(Fd::cwd(), file).ok()?;
    let mut record = RecordReader(&bytes);
    (record.bytes()? == FORMAT).then_some(())?;
    let all = record.list(|it| {
        Some((
            it.bytes()?.try_into().ok()?,
            Policy {
                expires: it.number()?,
                includes_subdomains: it.count()? != 0,
            },
        ))
    })?;
    let mut hosts = Hosts::default();
    for (host, policy) in all.into_iter().filter(|it| it.1.expires > wall_now()) {
        hosts.insert(host, policy);
    }
    Some(hosts)
}

fn write(file: &[u8], hosts: &Hosts) -> Option<()> {
    let mut record = RecordWriter::default();
    record.bytes(FORMAT);
    record.count(hosts.len());
    for (key, policy) in hosts {
        record.bytes(key);
        record.number(policy.expires);
        record.count(policy.includes_subdomains.into());
    }
    let partial = ZBox::from_bytes([file, b"~"].concat());
    File::make_open(
        partial.as_bytes(),
        O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC,
        0o600,
    )
    .ok()?
    .write_all(&record.0)
    .ok()?;
    bun_sys::rename(&partial, &ZBox::from_bytes(file)).ok()
}

impl Hsts {
    pub(super) fn new(directory: Option<&[u8]>) -> Hsts {
        Hsts {
            file: directory.map(|it| [it, b"/Transport Security"].concat().into()),
            hosts: Arc::default(),
        }
    }

    fn with_hosts<R>(&self, steps: impl FnOnce(&mut Hosts) -> R) -> R {
        steps(
            self.hosts
                .lock()
                .get_or_insert_with(|| self.file.as_deref().and_then(read).unwrap_or_default()),
        )
    }

    pub(super) fn upgrades(&self, url: &Url) -> bool {
        if url.scheme() != b"http" || url.has_address() || url.is_loopback() {
            return false;
        }
        let parents = core::iter::successors(Some(url.hostname()), |it| {
            Some(strings::split_once_char(it, b'.')?.1)
        });
        self.with_hosts(|hosts| {
            let applies = |(at, host): (usize, &[u8])| {
                hosts.get(&key_of(host)).is_some_and(|it| {
                    it.expires > wall_now() && (at == 0 || it.includes_subdomains)
                })
            };
            !hosts.is_empty() && parents.enumerate().any(applies)
        })
    }

    /// From a server with a valid certificate.
    pub(super) fn receive(&self, url: &Url, header: &[u8]) {
        const MAX_HOSTS: usize = 20_000;
        const YEAR: u64 = 365 * 86400;
        const UNSAVED_EXTENSION: f64 = 86400.0;
        let Some((age, includes_subdomains)) =
            parse(header).filter(|_| !url.has_address() && !url.is_loopback())
        else {
            return;
        };
        let (key, expires) = (key_of(url.hostname()), wall_now() + age.min(YEAR) as f64);
        let has_changed = self.with_hosts(|hosts| match hosts.get(&key) {
            _ if age == 0 => hosts.remove(&key).is_some(),
            Some(known)
                if known.includes_subdomains == includes_subdomains
                    && (0.0..UNSAVED_EXTENSION.min(age as f64 / 2.0))
                        .contains(&(expires - known.expires)) =>
            {
                false
            }
            None if hosts.len() >= MAX_HOSTS => false,
            _ => {
                hosts.insert(
                    key,
                    Policy {
                        expires,
                        includes_subdomains,
                    },
                );
                true
            }
        });
        if let Some(file) = self.file.clone().filter(|_| has_changed) {
            let hosts = Arc::clone(&self.hosts);
            drop(exec::blocking(move || write(&file, hosts.lock().as_ref()?)));
        }
    }
}
