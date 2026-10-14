//! The table as it ships, back to a table.
//!
//! After the header ([`Table::read_header`]): `units n, flows n, listed n` and the columns:
//! those of [`Table::read_units_and_flows`]; the answers to each [`Kind`] of question; whether each decoded target was
//! right, and the ones that were not; the same for the low bits of each `adrp`; and of the fixups that [`scan`] does not
//! ask about their place, form, target and extra.
//! The last 8 bytes are a [`checksum`].

use crate::bytes::Reader;
use crate::executable::Executable;
use crate::scan::{Answers, Kind, scan};
use crate::table::{Columns, Fixup, Form, KIND_COMPACT, Table};
use crate::{Error, Result};

/// Answers that are mostly the same: how many of the usual one lie before each of the other.
struct Recorded<'a> {
    runs: Reader<'a>,
    usual: bool,
    /// How many more times the usual answer comes. `None`: from here on.
    left: Option<u64>,
}

impl<'a> Recorded<'a> {
    fn new(bytes: &'a [u8], usual: bool) -> Result<Self> {
        let mut recorded = Self {
            runs: Reader::new(bytes),
            usual,
            left: None,
        };
        recorded.left = recorded.next_run()?;
        Ok(recorded)
    }

    fn next_run(&mut self) -> Result<Option<u64>> {
        if self.runs.is_empty() {
            Ok(None)
        } else {
            self.runs.unsigned().map(Some)
        }
    }

    fn next(&mut self) -> Result<bool> {
        match &mut self.left {
            None => Ok(self.usual),
            Some(0) => {
                self.left = self.next_run()?;
                Ok(!self.usual)
            }
            Some(left) => {
                *left -= 1;
                Ok(self.usual)
            }
        }
    }
}

struct Replay<'a, 't> {
    table: &'t Table,
    is_fixup: Vec<Recorded<'a>>,
    is_target_right: Recorded<'a>,
    other_targets: Reader<'a>,
    are_low_bits_right: Recorded<'a>,
    other_low_bits: Reader<'a>,
}

impl Answers for Replay<'_, '_> {
    fn is_fixup(&mut self, kind: Kind, _place: u64, _form: Form) -> Result<bool> {
        self.is_fixup[kind as usize].next()
    }

    fn target(&mut self, _place: u64, _form: Form, decoded: u32) -> Result<u32> {
        if self.is_target_right.next()? {
            Ok(decoded)
        } else {
            self.table.read_target(self.other_targets.unsigned()?)
        }
    }

    fn low_bits(&mut self, _place: u64, of_first_use: Option<u16>) -> Result<u16> {
        match of_first_use {
            Some(low) if self.are_low_bits_right.next()? => Ok(low),
            Some(_) => Ok(self.other_low_bits.unsigned()? as u16),
            // Asked all the same, so that both directions ask alike.
            None => {
                self.are_low_bits_right.next()?;
                Ok(self.other_low_bits.unsigned()? as u16)
            }
        }
    }
}

pub(crate) fn expand(bytes: &[u8], exe: &Executable<'_>) -> Result<Table> {
    let (bytes, expected) = bytes.split_last_chunk::<8>().ok_or(Error::InvalidTable)?;
    let (mut table, mut r) = Table::read_header(bytes, KIND_COMPACT)?;
    if table.format != exe.format {
        return Err(Error::TableOfAnotherExecutable);
    }
    let [units, flows, listed] = [r.count()?, r.count()?, r.count()?];
    let mut columns = Columns::read(r)?;
    table.read_units_and_flows(units, flows, &mut columns)?;

    let mut is_fixup = Vec::with_capacity(Kind::COUNT);
    for kind in 0..Kind::COUNT {
        is_fixup.push(Recorded::new(
            columns.next_bytes()?,
            Kind::usual_answer(kind),
        )?);
    }
    let mut replay = Replay {
        table: &table,
        is_fixup,
        is_target_right: Recorded::new(columns.next_bytes()?, true)?,
        other_targets: columns.next()?,
        are_low_bits_right: Recorded::new(columns.next_bytes()?, true)?,
        other_low_bits: columns.next()?,
    };
    // Bytes that are not the ones the answers were recorded for can lead the walk anywhere.
    let mut fixups = scan(&table, exe, &mut replay).map_err(|_| Error::TableOfAnotherExecutable)?;

    let [mut places, mut forms, mut targets, mut extras] = [
        columns.next()?,
        columns.next()?,
        columns.next()?,
        columns.next()?,
    ];
    let mut place = 0u64;
    for _ in 0..listed {
        place += places.unsigned()?;
        fixups.push(Fixup {
            place,
            form: Form::from_u8(forms.byte()?)?,
            target: table.read_target(targets.unsigned()?)?,
            extra: extras.unsigned()? as u16,
        });
    }
    fixups.sort_unstable();
    table.fixups = fixups;
    if checksum(bytes, &table.fixups) != u64::from_le_bytes(*expected) {
        return Err(Error::TableOfAnotherExecutable);
    }
    Ok(table)
}

/// Of all that precedes it in the table, and of the fixups, which are what is read off the executable. FNV-1a.
pub(crate) fn checksum(table: &[u8], fixups: &[Fixup]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    let mut add = |bytes: &[u8]| {
        for &byte in bytes {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
        }
    };
    add(table);
    for f in fixups {
        add(&f.place.to_le_bytes());
        add(&f.target.to_le_bytes());
        add(&f.extra.to_le_bytes());
        add(&[f.form as u8]);
    }
    hash
}
