use crate::DELIMITER;

/// The PATH that `bun run` and `bunx` give a script: the directories bun
/// prepends (`node_modules/.bin` of each ancestor, the `node` shim), then the
/// PATH the process inherited. It records where the prepended part ends, so
/// that no caller derives that from lengths.
pub struct RunPath {
    buf: Vec<u8>,
    prepended_len: usize,
}

impl RunPath {
    /// `prepended` is the delimiter-joined directories, with no trailing
    /// delimiter. `inherited` is `None` when the environment has no PATH: then
    /// nothing follows `prepended`, because a trailing delimiter is an empty
    /// entry, and an empty PATH entry is the current directory. An inherited
    /// PATH is appended as it is, the empty string included.
    pub fn new(mut prepended: Vec<u8>, inherited: Option<&[u8]>) -> Self {
        debug_assert!(!prepended.is_empty() && prepended.last() != Some(&DELIMITER));
        let prepended_len = prepended.len();
        if let Some(inherited) = inherited {
            prepended.reserve(inherited.len() + 1);
            prepended.push(DELIMITER);
            prepended.extend_from_slice(inherited);
        }
        Self {
            buf: prepended,
            prepended_len,
        }
    }

    /// The whole PATH value.
    pub fn as_bytes(&self) -> &[u8] {
        &self.buf
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.buf
    }

    /// The directories bun prepended, without a trailing delimiter.
    pub fn prepended(&self) -> &[u8] {
        &self.buf[..self.prepended_len]
    }

    /// The PATH the process inherited. `None` when it had none.
    pub fn inherited(&self) -> Option<&[u8]> {
        self.buf.get(self.prepended_len + 1..)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_the_boundary_for_every_inherited_path() {
        let d = DELIMITER as char;
        let prepended = format!("/p/node_modules/.bin{d}/node_modules/.bin");
        let states: [(Option<String>, String); 7] = [
            (None, prepended.clone()),
            (Some(String::new()), format!("{prepended}{d}")),
            (Some(format!("{d}")), format!("{prepended}{d}{d}")),
            (Some("/usr/bin".into()), format!("{prepended}{d}/usr/bin")),
            (
                Some(format!("/usr/bin{d}/bin")),
                format!("{prepended}{d}/usr/bin{d}/bin"),
            ),
            (
                Some(format!("/usr/bin{d}")),
                format!("{prepended}{d}/usr/bin{d}"),
            ),
            (
                Some(format!("{d}/usr/bin")),
                format!("{prepended}{d}{d}/usr/bin"),
            ),
        ];
        for (inherited, stitched) in states {
            let inherited = inherited.as_deref().map(str::as_bytes);
            let run_path = RunPath::new(prepended.clone().into_bytes(), inherited);
            assert_eq!(run_path.prepended(), prepended.as_bytes());
            assert_eq!(run_path.inherited(), inherited);
            assert_eq!(run_path.as_bytes(), stitched.as_bytes());
            assert_eq!(run_path.into_bytes(), stitched.into_bytes());
        }
    }
}
