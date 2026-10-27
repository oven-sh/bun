//! Which names to ask the servers for when looking up a host.

use bun_core::strings;

use crate::channel::Channel;
use crate::io::EnvVar;
use crate::system_config::load_file;
use crate::text::{HOST_NAME_SIZE, fields, is_hostname, printable_within, trim_start, word};
use crate::{Error, Result};

/// c-ares's buffer, with its NUL.
const ALIAS_SIZE: usize = 64;

impl Channel {
    /// hostname(7): the file `HOSTALIASES` names has a line `alias name` for each alias, which has no dot.
    fn host_alias(&mut self, name: &[u8]) -> Result<Option<Vec<u8>>> {
        if strings::contains_char(name, b'.') {
            return Ok(None);
        }
        let Some(path) = self.io.env(EnvVar::HostAliases) else {
            return Ok(None);
        };
        let text = match load_file(&mut *self.io, &path) {
            Ok(text) => text,
            Err(Error::ENOTFOUND) => return Ok(None),
            Err(error) => return Err(error),
        };
        for line in fields(&text, b"\n") {
            let (alias, rest) = word(line);
            let (target, _) = word(trim_start(rest));
            if printable_within(alias, ALIAS_SIZE)
                .is_some_and(|alias| alias.eq_ignore_ascii_case(name))
                && let Some(target) = printable_within(target, HOST_NAME_SIZE)
                && !target.is_empty()
                && is_hostname(target)
            {
                return Ok(Some(target.to_vec()));
            }
        }
        Ok(None)
    }

    /// In the order to try them.
    pub(super) fn search_names(&mut self, name: &[u8]) -> Result<Vec<Vec<u8>>> {
        if let Some(target) = self.host_alias(name)? {
            return Ok(vec![target]);
        }
        if name.ends_with(b".") {
            return Ok(vec![name.to_vec()]);
        }
        let as_is_first = strings::count_char(name, b'.') >= self.ndots;
        let mut names = Vec::with_capacity(self.search_domains.len() + 1);
        if as_is_first {
            names.push(name.to_vec());
        }
        for domain in &self.search_domains {
            let domain: &[u8] = if domain == b"." { b"" } else { domain };
            names.push([name, b".", domain].concat());
        }
        if !as_is_first {
            names.push(name.to_vec());
        }
        Ok(names)
    }
}
