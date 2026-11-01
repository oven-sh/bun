use crate::ir::Program;

// Seven bits a byte, the lowest first.
fn take_number(bytes: &mut &[u8]) -> Option<u64> {
    let (mut number, mut shift) = (0u64, 0);
    loop {
        let (&byte, rest) = bytes.split_first()?;
        *bytes = rest;
        number |= u64::from(byte & 0x7f).checked_shl(shift)?;
        shift += 7;
        if byte < 0x80 {
            return Some(number);
        }
    }
}

struct Cut {
    start: u64,
    removed: u64,
    added: u64,
    // How much shorter the kept text in front of it is than the file in front of it.
    shorter_in_front: i64,
}

// `PackedTypeRanges::as_bytes`
fn read_cuts(mut bytes: &[u8]) -> Option<Vec<Cut>> {
    let (mut cuts, mut end, mut shorter_in_front) = (Vec::new(), 0, 0);
    while !bytes.is_empty() {
        let start = end + take_number(&mut bytes)?;
        let removed = take_number(&mut bytes)?;
        let added = match removed {
            0 => take_number(&mut bytes)?,
            _ => 0,
        };
        cuts.push(Cut {
            start,
            removed,
            added,
            shorter_in_front,
        });
        end = start + removed;
        shorter_in_front += removed as i64 - added as i64;
    }
    Some(cuts)
}

fn place_in_kept_text(cuts: &[Cut], offset: u64) -> i64 {
    let behind = cuts.partition_point(|cut| cut.start < offset);
    match behind.checked_sub(1).map(|last| &cuts[last]) {
        Some(last) => {
            let removed = last.removed.min(offset - last.start) as i64;
            offset as i64 - last.shorter_in_front - removed + last.added as i64
        }
        None => offset as i64,
    }
}

#[derive(PartialEq, Debug)]
pub(super) enum Fault {
    EndsInAPiece,
    /// Where the piece starts and ends in the file.
    CopiesWhatHoldsIt(u64, u64),
}

impl core::fmt::Display for Fault {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Fault::EndsInAPiece => f.write_str("the list of printed text ends inside a piece"),
            Fault::CopiesWhatHoldsIt(start, end) => {
                write!(
                    f,
                    "the piece of printed text at {start}..{end} copies what holds it"
                )
            }
        }
    }
}

/// An executable finds what an error quotes in the text that it keeps, so the engine moves every piece through the cuts.
/// Whoever follows a copy prints the pieces in what is copied: a piece that lies there itself would be followed without end.
/// `pieces`: `FileLowering::find_text_printed_in_place`.
pub(super) fn find_fault(mut pieces: &[u8], cuts: &[u8]) -> Option<Fault> {
    let Some(cuts) = read_cuts(cuts) else {
        return Some(Fault::EndsInAPiece);
    };
    let place = |offset: u64| place_in_kept_text(&cuts, offset);
    let mut start = 0;
    let mut read = || -> Option<Option<Fault>> {
        while !pieces.is_empty() {
            start += take_number(&mut pieces)?;
            let end = start + take_number(&mut pieces)?;
            let printed = take_number(&mut pieces)?;
            if printed & 1 == 0 {
                pieces = pieces.get((printed >> 1) as usize..)?;
                continue;
            }
            let distance = take_number(&mut pieces)?;
            let distance = (distance >> 1) as i64 ^ -((distance & 1) as i64);
            let from = u64::try_from(start as i64 - distance).ok()?;
            let to = from + (printed >> 2);
            if place(start) < place(end) && place(from) <= place(start) && place(end) <= place(to) {
                return Some(Some(Fault::CopiesWhatHoldsIt(start, end)));
            }
        }
        Some(None)
    };
    read().unwrap_or(Some(Fault::EndsInAPiece))
}

pub(super) fn find_faults_in_program(program: &Program) -> Vec<(usize, Fault)> {
    let modules = program.modules.iter().enumerate();
    let faults = modules.filter_map(|(index, module)| {
        let pieces = &module.positions.text_printed_in_place;
        Some((
            index,
            find_fault(pieces, &module.types_cut_from_function_text)?,
        ))
    });
    faults.collect()
}

#[cfg(test)]
mod tests {
    use super::{Fault, find_fault};

    // `a ? true : false` at 10: a piece of 16 bytes that copies the 4 bytes at 14.
    const CONDITIONAL: [u8; 4] = [10, 16, 4 << 2 | 1, 7];

    #[test]
    fn a_copy_of_a_part_of_the_piece_is_sound() {
        assert_eq!(find_fault(&CONDITIONAL, &[]), None);
        assert_eq!(find_fault(&CONDITIONAL, &[10, 4]), None);
    }

    #[test]
    fn a_piece_of_which_only_what_it_copies_is_kept_is_found() {
        let cuts = [10, 4, 4, 8];
        assert_eq!(
            find_fault(&CONDITIONAL, &cuts),
            Some(Fault::CopiesWhatHoldsIt(10, 26))
        );
    }

    #[test]
    fn a_piece_that_is_cut_whole_is_passed_over() {
        assert_eq!(find_fault(&CONDITIONAL, &[10, 16]), None);
    }

    #[test]
    fn a_list_that_ends_in_a_piece_is_found() {
        assert_eq!(
            find_fault(&CONDITIONAL[..3], &[]),
            Some(Fault::EndsInAPiece)
        );
        assert_eq!(
            find_fault(&[0, 1, 5 << 1, b'a'], &[]),
            Some(Fault::EndsInAPiece)
        );
    }
}
