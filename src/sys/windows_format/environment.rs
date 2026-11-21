//! The environment block for `CreateProcessW`.

use core::cmp::Ordering;

const EQUALS: u16 = b'=' as u16;

/// Programs of Windows fail in strange ways without them.
const REQUIRED: [&str; 11] = [
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

/// The name of the current directory of a drive starts with a `=`.
fn name_len(entry: &[u16]) -> Option<usize> {
    Some(1 + entry.get(1..)?.iter().position(|&unit| unit == EQUALS)?)
}

pub(crate) struct Block {
    /// With both NULs at its end.
    pub(crate) units: Vec<u16>,
    pub(crate) path: Vec<u16>,
}

/// `entries` are `name=value`. Of those with the same name the last one counts.
pub(crate) fn build(
    entries: impl Iterator<Item = Vec<u16>>,
    inherited: impl Fn(&[u16]) -> Option<Vec<u16>>,
    to_upper: impl Fn(u16) -> u16,
) -> Block {
    let compare = |a: &[u16], b: &[u16]| -> Ordering {
        let (a, b) = (
            a.iter().map(|&it| to_upper(it)),
            b.iter().map(|&it| to_upper(it)),
        );
        a.cmp(b)
    };
    let named = |entry: Vec<u16>| Some((name_len(&entry)?, entry));
    let mut entries: Vec<(usize, Vec<u16>)> = entries.filter_map(named).collect();
    entries.reverse();
    entries.sort_by(|(a_len, a), (b_len, b)| compare(&a[..*a_len], &b[..*b_len]));
    entries.dedup_by(|(a_len, a), (b_len, b)| compare(&a[..*a_len], &b[..*b_len]).is_eq());

    let mut path = Vec::new();
    for required in REQUIRED {
        let name: Vec<u16> = required.bytes().map(u16::from).collect();
        let index = match entries.binary_search_by(|(len, it)| compare(&it[..*len], &name)) {
            Ok(index) => index,
            Err(index) => {
                let Some(value) = inherited(&name) else {
                    continue;
                };
                let entry = [&name[..], &[EQUALS], &value].concat();
                entries.insert(index, (name.len(), entry));
                index
            }
        };
        if required == "PATH" {
            path = entries[index].1[name.len() + 1..].to_vec();
        }
    }

    let mut units = Vec::with_capacity(entries.iter().map(|it| it.1.len() + 1).sum::<usize>() + 2);
    for (_, entry) in &entries {
        units.extend_from_slice(entry);
        units.push(0);
    }
    units.resize((units.len() + 1).max(2), 0);
    Block { units, path }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(entries: &[&str], inherited: &[(&str, &str)]) -> (String, String) {
        let Block { units, path } = build(
            entries.iter().map(|it| it.encode_utf16().collect()),
            |name| {
                let name = String::from_utf16(name).unwrap();
                let (_, value) = inherited.iter().find(|it| it.0 == name)?;
                Some(value.encode_utf16().collect())
            },
            |unit| u8::try_from(unit).map_or(unit, |it| it.to_ascii_uppercase().into()),
        );
        let text = |units: Vec<u16>| String::from_utf16(&units).unwrap();
        (text(units), text(path))
    }

    #[test]
    fn sorted_by_name_in_upper_case() {
        let (units, _) = block(&["b=1", "_=2", "A=3", "a1=4", "=D:=d", "=C:=c"], &[]);
        assert_eq!(units, "=C:=c\0=D:=d\0A=3\0a1=4\0b=1\0_=2\0\0");
    }

    #[test]
    fn the_last_of_a_name_counts() {
        let (units, path) = block(&["Path=1", "x=", "PATH=2", "path=3=4"], &[("PATH", "5")]);
        assert_eq!(units, "path=3=4\0x=\0\0");
        assert_eq!(path, "3=4");
    }

    #[test]
    fn required_variables_are_inherited() {
        let inherited = [("PATH", "p"), ("TEMP", "t"), ("WINDIR", ""), ("OTHER", "o")];
        let (units, path) = block(&["temp=mine", "Z=z"], &inherited);
        assert_eq!(units, "PATH=p\0temp=mine\0WINDIR=\0Z=z\0\0");
        assert_eq!(path, "p");
    }

    #[test]
    fn entries_without_a_value() {
        assert_eq!(block(&["", "=", "name"], &[]).0, "\0\0");
    }
}
