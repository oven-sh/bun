//! Error type for the in-process git reader.

use crate::oid::Oid;
use core::fmt;

/// Every failure mode of the crate. Everything under `.git/` is treated as
/// attacker-controlled input: malformed or hostile bytes surface as
/// [`GitError::Corrupt`], never a panic or an out-of-bounds read.
#[derive(Debug)]
pub enum GitError {
    /// The starting directory is not inside a git work tree.
    NotARepo,
    /// An operating-system error (errno + syscall + path preserved).
    Io(bun_sys::Error),
    /// Structurally invalid data. The message names the structure that failed
    /// validation (stable, `'static`, never derived from the hostile bytes).
    Corrupt(&'static str),
    /// Well-formed data using a feature this crate deliberately does not
    /// implement (e.g. split index, sha256 object format, idx v1).
    Unsupported(&'static str),
    /// A size declared by on-disk data exceeds this crate's hard ceilings.
    TooLarge(&'static str),
    /// The object store has no object with this id.
    MissingObject(Oid),
    /// A caller-supplied argument violated a documented precondition (e.g.
    /// an unsorted worktree listing). Not derived from on-disk data.
    InvalidInput(&'static str),
    /// The zlib/deflate decoder could not be constructed (allocation failure).
    OutOfMemory,
}

impl fmt::Display for GitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GitError::NotARepo => f.write_str("not a git repository"),
            // NOT `bun_sys::Error`'s own `Display`, which routes through
            // `BunString` / WTF strings — C symbols absent from this
            // crate's standalone test binary.
            GitError::Io(err) => {
                write!(
                    f,
                    "{} from {} on {}",
                    bstr::BStr::new(err.name()),
                    <&'static str>::from(err.syscall),
                    bstr::BStr::new(&err.path),
                )
            }
            GitError::Corrupt(what) => write!(f, "corrupt git data: {what}"),
            GitError::Unsupported(what) => write!(f, "unsupported git feature: {what}"),
            GitError::TooLarge(what) => write!(f, "git data exceeds size limit: {what}"),
            GitError::MissingObject(oid) => {
                write!(f, "missing git object: {}", oid)
            }
            GitError::InvalidInput(what) => write!(f, "invalid argument: {what}"),
            GitError::OutOfMemory => f.write_str("out of memory"),
        }
    }
}

impl std::error::Error for GitError {}

impl From<bun_sys::Error> for GitError {
    fn from(err: bun_sys::Error) -> Self {
        GitError::Io(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_is_stable() {
        let cases: &[(GitError, &str)] = &[
            (GitError::NotARepo, "not a git repository"),
            (
                GitError::Corrupt("index header"),
                "corrupt git data: index header",
            ),
            (
                GitError::Unsupported("split index"),
                "unsupported git feature: split index",
            ),
            (
                GitError::TooLarge("delta"),
                "git data exceeds size limit: delta",
            ),
            (GitError::OutOfMemory, "out of memory"),
        ];
        for (err, expected) in cases {
            assert_eq!(format!("{err}"), *expected);
        }
        let missing = GitError::MissingObject(Oid([0xab; 20]));
        assert_eq!(
            format!("{missing}"),
            format!("missing git object: {}", "ab".repeat(20))
        );
    }
}
