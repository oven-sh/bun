//! Parser for `FILE_NOTIFY_INFORMATION` records.

#[derive(PartialEq, Eq)]
pub struct Change {
    pub action: u32,
    /// Relative to the watched directory.
    pub name: Vec<u16>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct InvalidRecord;

/// Stops after the first invalid record.
pub fn parse(bytes: &[u8]) -> impl Iterator<Item = Result<Change, InvalidRecord>> {
    let mut rest = Some(bytes);
    core::iter::from_fn(move || {
        let (change, next) = match parse_record(rest.take()?) {
            Some(parsed) => parsed,
            None => return Some(Err(InvalidRecord)),
        };
        rest = next;
        Some(Ok(change))
    })
}

fn parse_record(record: &[u8]) -> Option<(Change, Option<&[u8]>)> {
    const NAME_OFFSET: usize = 12;
    let [next_offset, action, name_len]: [u32; 3] = bun_core::read_prefix(record)?;
    let name_bytes = record[NAME_OFFSET..].get(..name_len as usize)?;
    let mut name: Vec<u16> = bun_core::vec_from_bytes(name_bytes)?;
    name.truncate(name.iter().take_while(|&&unit| unit != 0).count());
    let change = Change { action, name };
    match next_offset as usize {
        0 => Some((change, None)),
        offset if offset >= NAME_OFFSET + name_bytes.len() => {
            Some((change, Some(record.get(offset..)?)))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_record(next_offset: u32, action: u32, name_len: u32, name: &str) -> Vec<u8> {
        let header = [next_offset, action, name_len].map(u32::to_le_bytes);
        let name = name.encode_utf16().flat_map(u16::to_le_bytes);
        header.into_iter().flatten().chain(name).collect()
    }

    fn parse_names(bytes: &[u8]) -> Vec<Result<String, InvalidRecord>> {
        let to_name = |change: Change| String::from_utf16(&change.name).unwrap();
        parse(bytes).map(|change| change.map(to_name)).collect()
    }

    #[test]
    fn parses_unaligned_records() {
        let bytes = [
            encode_record(14, 1, 2, "a"),
            encode_record(16, 3, 2, "b?"),
            encode_record(0, 2, 0, ""),
        ]
        .concat();
        assert_eq!(
            parse_names(&bytes),
            [Ok("a".into()), Ok("b".into()), Ok("".into())]
        );
    }

    #[test]
    fn reports_incomplete_record() {
        assert_eq!(parse_names(&[]), [Err(InvalidRecord)]);
        assert_eq!(
            parse_names(&encode_record(0, 1, 4, "a")),
            [Err(InvalidRecord)]
        );
        assert_eq!(
            parse_names(&encode_record(14, 1, 2, "a")),
            [Ok("a".into()), Err(InvalidRecord)]
        );
    }
}
