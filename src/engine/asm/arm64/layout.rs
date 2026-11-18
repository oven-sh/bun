//! Fills in distances, and replaces the instructions that do not reach with sequences that do.

use super::assembler::{Assembler, NOP, SiteKind, padding};
use crate::buffer::{CodeBuffer, Site};
use crate::label::{Code, CodeTooLarge, Label, LabelState, Relocation, RelocationKind, resolve};

const B: u32 = 0x1400_0000;
const ADRP: u32 = 0x9000_0000;
const ADD_X_IMMEDIATE: u32 = 0x9100_0000;
const LOG2_PAGE: u32 = 12;
const EXACT_ROUNDS: u32 = 8;

impl Assembler {
    pub fn finish(mut self) -> Result<Code, CodeTooLarge> {
        self.take_code()
    }

    pub(crate) fn take_code(&mut self) -> Result<Code, CodeTooLarge> {
        self.leave_replaceable_bytes();
        self.put_routes();
        let end = self.buffer.mark();
        if self.buffer.has_data() {
            self.pad(4, 12);
            self.buffer.put_data(|table| SiteKind::TableEntry { table });
        }
        self.buffer.check_size()?;
        self.buffer.settle_aliases();
        if self.buffer.len > reach(SiteKind::Branch14) {
            widen_what_does_not_reach(&mut self.buffer)?;
        }
        fill_distances(&mut self.buffer);
        Ok(self.buffer.take_code(end))
    }

    fn put_routes(&mut self) {
        if self.buffer.aliases_external {
            self.route_branches_to_aliases();
        }
        for (index, route) in (0..).zip(core::mem::take(&mut self.routes)) {
            if let Some(route) = route {
                self.buffer.bind(route);
                self.b(Label(Label::EXTERNAL | index));
            }
        }
    }

    fn route_branches_to_aliases(&mut self) {
        for index in 0..self.buffer.sites.len() {
            let site = self.buffer.sites[index];
            if matches!(site.kind, SiteKind::Branch19 | SiteKind::Branch14)
                && self.buffer.state(site.label).offset == LabelState::EXTERNAL
            {
                self.buffer.sites[index].label = self.route_to(site.label);
            }
        }
    }
}

/// In bytes, in either direction.
fn reach(kind: SiteKind) -> u32 {
    match kind {
        SiteKind::Branch14 => (32 << 10) - 4,
        SiteKind::Branch19 | SiteKind::Literal19 { .. } | SiteKind::Address21 => (1 << 20) - 4,
        SiteKind::Branch26 | SiteKind::TableEntry { .. } | SiteKind::Padding { .. } => u32::MAX,
    }
}

fn growth(kind: SiteKind) -> i32 {
    match kind {
        SiteKind::Branch14 | SiteKind::Branch19 | SiteKind::Address21 => 4,
        SiteKind::Literal19 { size } => 4 + i32::from(size),
        SiteKind::Branch26 | SiteKind::TableEntry { .. } | SiteKind::Padding { .. } => {
            unreachable!("always reaches")
        }
    }
}

/// For each site how many bytes could be added before it at most, and then the total.
fn greatest_additions(sites: &[Site<SiteKind>], added: &mut Vec<i32>) {
    added.clear();
    let mut total = 0;
    for site in sites {
        added.push(total);
        if let SiteKind::Padding { max, size, .. } = site.kind {
            total += i32::from(max - size);
        } else if reach(site.kind) != u32::MAX {
            total += growth(site.kind);
        }
    }
    added.push(total);
}

/// For each site how many bytes are added before it, and then the total.
fn additions(sites: &[Site<SiteKind>], widened: &[bool], added: &mut Vec<i32>) {
    added.clear();
    let mut total = 0;
    for (site, &widened) in sites.iter().zip(widened) {
        added.push(total);
        if let SiteKind::Padding { log2, max, size } = site.kind {
            total +=
                padding(site.at.wrapping_add_signed(total), log2, max) as i32 - i32::from(size);
        } else if widened {
            total += growth(site.kind);
        }
    }
    added.push(total);
}

fn widen_what_does_not_reach(buffer: &mut CodeBuffer<SiteKind>) -> Result<(), CodeTooLarge> {
    let mut widened = vec![false; buffer.sites.len()];
    let mut added = Vec::new();
    let mut any = false;
    for round in 0.. {
        // What reaches even then is settled, so code in which each round leads to another takes no more.
        let assumes_the_worst = round == EXACT_ROUNDS;
        if assumes_the_worst {
            greatest_additions(&buffer.sites, &mut added);
        } else {
            additions(&buffer.sites, &widened, &mut added);
        }
        let mut changed = false;
        for (index, site) in buffer.sites.iter().enumerate() {
            if widened[index] || reach(site.kind) == u32::MAX {
                continue;
            }
            let target = resolve(&buffer.labels, site.label);
            assert!(target.is_bound(), "a label that is used is never bound");
            let from = site.at.wrapping_add_signed(added[index]);
            let to = target
                .offset
                .wrapping_add_signed(added[target.link as usize]);
            if from.abs_diff(to) > reach(site.kind) {
                widened[index] = true;
                changed = true;
            }
        }
        if !changed && !assumes_the_worst {
            break;
        }
        any = true;
    }
    if any {
        rewrite(buffer, &widened, &added)?;
    }
    Ok(())
}

fn rewrite(
    buffer: &mut CodeBuffer<SiteKind>,
    widened: &[bool],
    added: &[i32],
) -> Result<(), CodeTooLarge> {
    let len = buffer.len.wrapping_add_signed(added[buffer.sites.len()]);
    if len as usize > buffer.limit {
        return Err(CodeTooLarge);
    }
    let old = &buffer.bytes[..buffer.len as usize];
    let mut new = Vec::with_capacity(len as usize);
    let mut sites = Vec::with_capacity(buffer.sites.len());
    let mut copied = 0;
    for (index, site) in buffer.sites.iter().enumerate() {
        let at = site.at as usize;
        let new_at = site.at.wrapping_add_signed(added[index]);
        if let SiteKind::Padding { log2, max, size } = site.kind {
            new.extend_from_slice(&old[copied..at]);
            for _ in 0..padding(new_at, log2, max) / 4 {
                new.extend_from_slice(&NOP.to_le_bytes());
            }
            copied = at + usize::from(size);
            continue;
        }
        if !widened[index] {
            sites.push(Site {
                at: new_at,
                ..*site
            });
            continue;
        }
        new.extend_from_slice(&old[copied..at]);
        copied = at + 4;
        let word = read_word(old, at);
        let target = resolve(&buffer.labels, site.label);
        let mut put = |word: u32| new.extend_from_slice(&word.to_le_bytes());
        match site.kind {
            SiteKind::Branch14 | SiteKind::Branch19 => {
                put(with_distance(site.kind, inverted_branch(word), 8));
                put(B);
                sites.push(Site {
                    at: new_at + 4,
                    label: site.label,
                    kind: SiteKind::Branch26,
                });
            }
            SiteKind::Literal19 { size } => {
                put(with_distance(site.kind, word, 8));
                put(with_distance(SiteKind::Branch26, B, 4 + i32::from(size)));
                new.extend_from_slice(&old[target.offset as usize..][..size.into()]);
            }
            SiteKind::Address21 => {
                let dst = word & 31;
                let to = target
                    .offset
                    .wrapping_add_signed(added[target.link as usize]);
                let pages = (to >> LOG2_PAGE).wrapping_sub(new_at >> LOG2_PAGE);
                put(with_distance(site.kind, ADRP | dst, pages as i32));
                put(ADD_X_IMMEDIATE | (to % (1 << LOG2_PAGE)) << 10 | dst << 5 | dst);
                buffer.alignment = 1 << LOG2_PAGE;
            }
            _ => unreachable!("always reaches"),
        }
    }
    new.extend_from_slice(&old[copied..]);
    assert!(new.len() == len as usize);
    for label in buffer.labels.iter_mut().filter(|label| label.is_bound()) {
        label.offset = label.offset.wrapping_add_signed(added[label.link as usize]);
    }
    (buffer.bytes, buffer.len, buffer.sites) = (new, len, sites);
    Ok(())
}

fn inverted_branch(word: u32) -> u32 {
    const CONDITIONAL_BRANCH: u32 = 0x54;
    if word >> 24 == CONDITIONAL_BRANCH {
        word ^ 1
    } else {
        word ^ 1 << 24
    }
}

fn read_word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(*bytes[at..].first_chunk().unwrap())
}

/// The field for the distance in `word` is clear. Only `adrp`, which counts pages, has low bits to put.
#[inline]
fn with_distance(kind: SiteKind, word: u32, distance: i32) -> u32 {
    let (mask, first_bit) = match kind {
        SiteKind::Branch26 => (0x03ff_ffff, 0),
        SiteKind::Branch19 | SiteKind::Literal19 { .. } | SiteKind::Address21 => (0x7_ffff, 5),
        SiteKind::Branch14 => (0x3fff, 5),
        SiteKind::TableEntry { .. } => (0x3fff_ffff, 2),
        SiteKind::Padding { .. } => (0, 0),
    };
    let distance = distance as u32;
    word | (distance >> 2 & mask) << first_bit | (distance & 3) << 29
}

fn fill_distances(buffer: &mut CodeBuffer<SiteKind>) {
    let CodeBuffer {
        bytes,
        sites,
        labels,
        externals,
        relocations,
        ..
    } = buffer;
    relocations.reserve(externals.len());
    for site in sites.iter() {
        let origin = match site.kind {
            SiteKind::Padding { .. } => continue,
            SiteKind::TableEntry { table } => labels[table.0 as usize].offset,
            _ => site.at,
        };
        let target = resolve(labels, site.label);
        if target.offset == LabelState::EXTERNAL {
            assert!(
                site.kind == SiteKind::Branch26,
                "only jumps and calls leave the code"
            );
            relocations.push(Relocation {
                offset: site.at,
                kind: RelocationKind::Branch26,
                target: externals[target.link as usize],
            });
            continue;
        }
        assert!(target.is_bound(), "a label that is used is never bound");
        let at = site.at as usize;
        let word = with_distance(
            site.kind,
            read_word(bytes, at),
            target.offset.wrapping_sub(origin) as i32,
        );
        bytes[at..at + 4].copy_from_slice(&word.to_le_bytes());
    }
}
