//! The environment block for `CreateProcessW`.

use core::cmp::Ordering;

const EQUALS: u16 = b'=' as u16;

/// Inherited when missing, because Windows programs depend on them.
const REQUIRED_VARIABLES: [&str; 11] = [
    "HOMEDRIVE",
    "HOMEPATH",
    "LOGONSERVER",
    "PATH",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
];

/// A leading `=` belongs to the name, as in the per-drive working directory variable `=C:`.
fn name_len(entry: &[u16]) -> Option<usize> {
    Some(1 + entry.get(1..)?.iter().position(|&unit| unit == EQUALS)?)
}

pub(crate) struct Environment {
    /// Ends with two NULs.
    pub(crate) block: Vec<u16>,
    pub(crate) path_env: Vec<u16>,
}

/// `entries` are `name=value`. The last entry wins for a duplicate name.
pub(crate) fn build(
    entries: impl Iterator<Item = Vec<u16>>,
    get_inherited: impl Fn(&[u16]) -> Option<Vec<u16>>,
    to_upper: impl Fn(u16) -> u16,
) -> Environment {
    let compare = |a: &[u16], b: &[u16]| -> Ordering {
        let a = a.iter().map(|&unit| to_upper(unit));
        let b = b.iter().map(|&unit| to_upper(unit));
        a.cmp(b)
    };
    let parse_entry = |entry: Vec<u16>| Some((name_len(&entry)?, entry));
    let mut entries: Vec<(usize, Vec<u16>)> = entries.filter_map(parse_entry).collect();
    entries.reverse();
    entries.sort_by(|(a_len, a), (b_len, b)| compare(&a[..*a_len], &b[..*b_len]));
    entries.dedup_by(|(a_len, a), (b_len, b)| compare(&a[..*a_len], &b[..*b_len]).is_eq());

    let mut path_env = Vec::new();
    for variable in REQUIRED_VARIABLES {
        let name: Vec<u16> = variable.bytes().map(u16::from).collect();
        let index = match entries.binary_search_by(|(len, entry)| compare(&entry[..*len], &name)) {
            Ok(index) => index,
            Err(index) => {
                let Some(value) = get_inherited(&name) else {
                    continue;
                };
                let entry = [&name[..], &[EQUALS], &value].concat();
                entries.insert(index, (name.len(), entry));
                index
            }
        };
        if variable == "PATH" {
            path_env = entries[index].1[name.len() + 1..].to_vec();
        }
    }

    let entries_len: usize = entries.iter().map(|(_, entry)| entry.len() + 1).sum();
    let mut block = Vec::with_capacity(entries_len + 2);
    for (_, entry) in &entries {
        block.extend_from_slice(entry);
        block.push(0);
    }
    block.resize((block.len() + 1).max(2), 0);
    Environment { block, path_env }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_strings(entries: &[&str], inherited: &[(&str, &str)]) -> (String, String) {
        let Environment { block, path_env } = build(
            entries.iter().map(|entry| entry.encode_utf16().collect()),
            |name| {
                let name = String::from_utf16(name).unwrap();
                let (_, value) = inherited.iter().find(|variable| variable.0 == name)?;
                Some(value.encode_utf16().collect())
            },
            |unit| u8::try_from(unit).map_or(unit, |byte| byte.to_ascii_uppercase().into()),
        );
        let from_wide = |units: Vec<u16>| String::from_utf16(&units).unwrap();
        (from_wide(block), from_wide(path_env))
    }

    #[test]
    fn sorts_by_uppercase_name() {
        let (block, _) = build_strings(&["b=1", "_=2", "A=3", "a1=4", "=D:=d", "=C:=c"], &[]);
        assert_eq!(block, "=C:=c\0=D:=d\0A=3\0a1=4\0b=1\0_=2\0\0");
    }

    #[test]
    fn last_duplicate_wins() {
        let (block, path_env) =
            build_strings(&["Path=1", "x=", "PATH=2", "path=3=4"], &[("PATH", "5")]);
        assert_eq!(block, "path=3=4\0x=\0\0");
        assert_eq!(path_env, "3=4");
    }

    #[test]
    fn required_variables_are_inherited() {
        let inherited = [("PATH", "p"), ("TEMP", "t"), ("WINDIR", ""), ("OTHER", "o")];
        let (block, path_env) = build_strings(&["temp=mine", "Z=z"], &inherited);
        assert_eq!(block, "PATH=p\0temp=mine\0WINDIR=\0Z=z\0\0");
        assert_eq!(path_env, "p");
    }

    #[test]
    fn drops_entries_without_separator() {
        assert_eq!(build_strings(&["", "=", "name"], &[]).0, "\0\0");
    }
}
