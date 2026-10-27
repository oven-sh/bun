//! Which names to ask the servers for when looking up a host.

use bun_core::strings;

use crate::buf::is_hostname_byte;
use crate::channel::Channel;
use crate::io::Variable;
use crate::sysconfig::load_file;
use crate::text::{fits, split, trim_start, word};
use crate::{Error, Result};

impl Channel {
    /// hostname(7): the file `HOSTALIASES` names has a line `alias name` for each alias, which has no dot.
    fn host_alias(&mut self, name: &[u8]) -> Result<Vec<u8>> {
        if strings::contains_char(name, b'.') {
            return Err(Error::ENOTFOUND);
        }
        let path = self.io.env(Variable::HostAliases).ok_or(Error::ENOTFOUND)?;
        let text = load_file(&mut *self.io, &path)?;
        for line in split(&text, b"\n", true, None) {
            let (alias, rest) = word(line);
            let (target, _) = word(trim_start(rest));
            if fits(alias, 64).is_some_and(|alias| alias.eq_ignore_ascii_case(name))
                && let Some(target) = fits(target, 256)
                && !target.is_empty()
                && target.iter().all(|&byte| is_hostname_byte(byte))
            {
                return Ok(target.to_vec());
            }
        }
        Err(Error::ENOTFOUND)
    }

    /// In the order to try them.
    pub(super) fn search_names(&mut self, name: &[u8]) -> Result<Vec<Vec<u8>>> {
        match self.host_alias(name) {
            Ok(target) => return Ok(vec![target]),
            Err(Error::ENOTFOUND) => {}
            Err(error) => return Err(error),
        }
        if name.ends_with(b".") {
            return Ok(vec![name.to_vec()]);
        }
        let as_is_first = strings::count_char(name, b'.') >= self.ndots;
        let mut names = Vec::with_capacity(self.domains.len() + 1);
        if as_is_first {
            names.push(name.to_vec());
        }
        for domain in &self.domains {
            let domain: &[u8] = if domain == b"." { b"" } else { domain };
            names.push([name, b".", domain].concat());
        }
        if !as_is_first {
            names.push(name.to_vec());
        }
        Ok(names)
    }
}
