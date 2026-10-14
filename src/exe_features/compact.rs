//! A table, reduced to what cannot be read off the executable. The other direction, and the layout: [`crate::expand`].

use crate::bytes::Writer;
use crate::executable::Executable;
use crate::expand::checksum;
use crate::scan::{Answers, Kind, scan};
use crate::table::{Fixup, Form, KIND_COMPACT, NO_UNIT, Table};
use crate::{Error, Result};

/// Answers that are mostly the same: how many of the usual one lie before each of the other.
struct Recording {
    runs: Writer,
    usual: bool,
    run: u64,
}

impl Recording {
    fn new(usual: bool) -> Self {
        Self {
            runs: Writer::default(),
            usual,
            run: 0,
        }
    }

    fn push(&mut self, answer: bool) {
        if answer == self.usual {
            self.run += 1;
        } else {
            self.runs.unsigned(self.run);
            self.run = 0;
        }
    }
}

fn written(target: u32) -> u64 {
    if target == NO_UNIT {
        0
    } else {
        u64::from(target) + 1
    }
}

struct Record<'t> {
    table: &'t Table,
    /// Which fixups of the table the walk asked about.
    was_asked: Vec<bool>,
    is_fixup: Vec<Recording>,
    is_target_right: Recording,
    other_targets: Writer,
    are_low_bits_right: Recording,
    other_low_bits: Writer,
}

impl Record<'_> {
    /// The fixup of this form at `place`. An edge that is nothing but an edge is never asked about.
    fn find(&self, place: u64, form: Form) -> Option<usize> {
        let from = self
            .table
            .fixups
            .partition_point(|f| (f.place, f.form) < (place, form));
        self.table
            .fixups
            .get(from)
            .is_some_and(|f| (f.place, f.form) == (place, form))
            .then_some(from)
    }
}

impl Answers for Record<'_> {
    fn is_fixup(&mut self, kind: Kind, place: u64, form: Form) -> Result<bool> {
        let found = self.find(place, form);
        self.is_fixup[kind as usize].push(found.is_some());
        if let Some(x) = found {
            self.was_asked[x] = true;
        }
        Ok(found.is_some())
    }

    fn target(&mut self, place: u64, form: Form, decoded: u32) -> Result<u32> {
        let actual = self.table.fixups[self.find(place, form).ok_or(Error::Inconsistent)?].target;
        self.is_target_right.push(actual == decoded);
        if actual != decoded {
            self.other_targets.unsigned(written(actual));
        }
        Ok(actual)
    }

    fn low_bits(&mut self, place: u64, of_first_use: Option<u16>) -> Result<u16> {
        let fixup =
            &self.table.fixups[self.find(place, Form::Page21).ok_or(Error::Inconsistent)?];
        // If it refers to nothing that moves or dies, any low bits that say so will do.
        let actual = match of_first_use {
            Some(low) if fixup.target == NO_UNIT => low,
            _ => fixup.extra,
        };
        self.are_low_bits_right.push(of_first_use == Some(actual));
        if of_first_use != Some(actual) {
            self.other_low_bits.unsigned(actual.into());
        }
        Ok(actual)
    }
}

pub(crate) fn compact(t: &Table, exe: &Executable<'_>) -> Result<Vec<u8>> {
    let is_repeated =
        |(a, b): (&Fixup, &Fixup)| a.form != Form::None && (a.place, a.form) == (b.place, b.form);
    if t.fixups
        .iter()
        .zip(t.fixups.iter().skip(1))
        .any(is_repeated)
    {
        return Err(Error::InvalidTable); // two fixups of one form at one place
    }
    let mut record = Record {
        table: t,
        was_asked: vec![false; t.fixups.len()],
        is_fixup: (0..Kind::COUNT)
            .map(|kind| Recording::new(Kind::usual_answer(kind)))
            .collect(),
        is_target_right: Recording::new(true),
        other_targets: Writer::default(),
        are_low_bits_right: Recording::new(true),
        other_low_bits: Writer::default(),
    };
    scan(t, exe, &mut record)?;

    let mut columns: Vec<Writer> = Vec::new();
    let [mut gaps, mut sizes, mut flags, mut aligns] = [const { Writer { bytes: Vec::new() } }; 4];
    let mut end = 0;
    for unit in &t.units {
        gaps.unsigned(unit.start - end);
        sizes.unsigned(unit.size);
        flags.bytes.push(unit.flags);
        if unit.starts_piece() {
            aligns.bytes.push(unit.log2_align);
        }
        end = unit.end();
    }
    columns.extend([gaps, sizes, flags, aligns]);
    let [mut froms, mut tos, mut conditions] = [const { Writer { bytes: Vec::new() } }; 3];
    let mut previous = 0;
    for flow in &t.flows {
        froms.unsigned(u64::from(flow.from - previous));
        tos.signed(i64::from(flow.to) - i64::from(flow.from));
        conditions.unsigned(flow.condition.into());
        previous = flow.from;
    }
    columns.extend([froms, tos, conditions]);
    columns.extend(record.is_fixup.into_iter().map(|r| r.runs));
    columns.extend([
        record.is_target_right.runs,
        record.other_targets,
        record.are_low_bits_right.runs,
        record.other_low_bits,
    ]);

    // what the walk did not ask about
    let [mut places, mut forms, mut targets, mut extras] =
        [const { Writer { bytes: Vec::new() } }; 4];
    let (mut previous, mut listed) = (0, 0u64);
    for (f, _) in t
        .fixups
        .iter()
        .zip(&record.was_asked)
        .filter(|(_, was_asked)| !**was_asked)
    {
        places.unsigned(f.place - previous);
        forms.bytes.push(f.form as u8);
        targets.unsigned(written(f.target));
        extras.unsigned(f.extra.into());
        previous = f.place;
        listed += 1;
    }
    columns.extend([places, forms, targets, extras]);

    let mut out = t.write_header(KIND_COMPACT);
    out.unsigned(t.units.len() as u64);
    out.unsigned(t.flows.len() as u64);
    out.unsigned(listed);
    out.unsigned(columns.len() as u64);
    for column in &columns {
        out.unsigned(column.bytes.len() as u64);
    }
    for column in &columns {
        out.bytes.extend_from_slice(&column.bytes);
    }
    let checksum = checksum(&out.bytes, &t.fixups);
    out.bytes.extend_from_slice(&checksum.to_le_bytes());
    Ok(out.bytes)
}
