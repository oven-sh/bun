//! What `Bun.cron` computes without the engine or the OS: schedules, and the text each OS scheduler is given.

pub mod crontab;
mod expression;
pub mod launchd;
pub mod schtasks;

pub use expression::{CronError, CronExpression, TimeZone, WallClock};

use core::fmt::{self, Display, Write as _};

use bstr::ByteSlice as _;

/// The name of an OS-level job. It goes unquoted into a crontab line, a file name and XML.
#[derive(Clone)]
pub struct Title(Box<str>);

impl Title {
    /// `None` unless `title` is one or more of `[a-zA-Z0-9_-]`.
    pub fn new(title: &[u8]) -> Option<Title> {
        let is_allowed = |&c: &u8| c.is_ascii_alphanumeric() || c == b'-' || c == b'_';
        (!title.is_empty() && title.iter().all(is_allowed))
            .then(|| Title(title.iter().map(|&c| char::from(c)).collect()))
    }
}

impl Display for Title {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// What the OS is asked to run: `<exe> run --cron-title=<title> --cron-period=<schedule> <script>`.
pub struct Registration<'a> {
    pub title: Title,
    pub schedule: CronExpression,
    pub exe: &'a [u8],
    pub script: &'a [u8],
}

/// Escaped. The document has to be UTF-8, so a byte that is not becomes U+FFFD.
struct XmlText<'a>(&'a [u8]);

impl Display for XmlText<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.chars().try_for_each(|c| match c {
            '&' => f.write_str("&amp;"),
            '<' => f.write_str("&lt;"),
            '>' => f.write_str("&gt;"),
            '"' => f.write_str("&quot;"),
            '\'' => f.write_str("&apos;"),
            _ => f.write_char(c),
        })
    }
}

#[cfg(test)]
mod tests;
