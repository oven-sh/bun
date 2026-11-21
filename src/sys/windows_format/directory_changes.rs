//! The `FILE_NOTIFY_INFORMATION` records that report changes in a directory.

pub struct Change {
    pub action: u32,
    /// Relative to the directory.
    pub name: Vec<u16>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Malformed;

/// Ends with the first that is malformed.
pub fn parse(bytes: &[u8]) -> impl Iterator<Item = Result<Change, Malformed>> {
    let mut rest = Some(bytes);
    core::iter::from_fn(move || {
        let (change, next) = match parse_one(rest.take()?) {
            Some(parsed) => parsed,
            None => return Some(Err(Malformed)),
        };
        rest = next;
        Some(Ok(change))
    })
}

fn parse_one(record: &[u8]) -> Option<(Change, Option<&[u8]>)> {
    const NAME_OFFSET: usize = 12;
    let [next_offset, action, name_len]: [u32; 3] = bun_core::read_prefix(record)?;
    let name = record[NAME_OFFSET..].get(..name_len as usize)?;
    let mut units: Vec<u16> = bun_core::vec_from_bytes(name)?;
    units.truncate(units.iter().take_while(|&&unit| unit != 0).count());
    let change = Change {
        action,
        name: units,
    };
    match next_offset as usize {
        0 => Some((change, None)),
        offset if offset >= NAME_OFFSET + name.len() => Some((change, Some(record.get(offset..)?))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(next_offset: u32, action: u32, name_len: u32, name: &str) -> Vec<u8> {
        let head = [next_offset, action, name_len].map(u32::to_le_bytes);
        let name = name.encode_utf16().flat_map(u16::to_le_bytes);
        head.into_iter().flatten().chain(name).collect()
    }

    fn names(bytes: &[u8]) -> Vec<Result<String, Malformed>> {
        let text = |change: Change| String::from_utf16(&change.name).unwrap();
        parse(bytes).map(|change| change.map(text)).collect()
    }

    #[test]
    fn records_need_no_alignment() {
        let bytes = [
            record(14, 1, 2, "a"),
            record(16, 3, 2, "b?"),
            record(0, 2, 0, ""),
        ]
        .concat();
        assert_eq!(
            names(&bytes),
            [Ok("a".into()), Ok("b".into()), Ok("".into())]
        );
    }

    #[test]
    fn lengths_that_do_not_fit() {
        assert_eq!(names(&[]), [Err(Malformed)]);
        assert_eq!(names(&record(0, 1, 4, "a")), [Err(Malformed)]);
        assert_eq!(
            names(&record(14, 1, 2, "a")),
            [Ok("a".into()), Err(Malformed)]
        );
    }
}
