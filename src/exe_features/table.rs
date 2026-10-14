//! The table: which bytes of the executable only which features need.
//!
//! It is in the executable it is about, in room that `bun_core::feature` reserves, so there is no telling one that belongs
//! to another executable. Addresses are those the file says its bytes are loaded at (PE: from the image base).

use core::ops::Range;

use crate::bytes::Reader;
use crate::{Error, Result};

pub(crate) const MAGIC: &[u8; 8] = b"BUNFEAT\x01";

pub(crate) struct Table<'a> {
    pub(crate) features: Vec<&'a [u8]>,
    /// Sorted, not overlapping. Each with the features that need it, as indexes: it goes once all of them are excluded.
    pub(crate) ranges: Vec<(Range<u64>, Vec<usize>)>,
    pub(crate) markers: Vec<Marker<'a>>,
}

/// `bun_core::feature::present`
pub(crate) struct Marker<'a> {
    pub(crate) address: u64,
    pub(crate) feature: usize,
    /// What is there: the no-op.
    pub(crate) present: &'a [u8],
    /// What is to be there without the feature: a jump. As long.
    pub(crate) excluded: &'a [u8],
}

impl<'a> Table<'a> {
    pub(crate) fn read(room: &'a [u8]) -> Result<Self> {
        let Some(body) = room.strip_prefix(MAGIC) else {
            return Err(Error::MissingTable);
        };
        let mut r = Reader::new(body);
        let mut features = Vec::new();
        for _ in 0..r.count()? {
            features.push(r.blob()?);
        }
        let mut sets = Vec::new();
        for _ in 0..r.count()? {
            let mut set = Vec::new();
            for _ in 0..r.count()? {
                set.push(r.index(features.len())?);
            }
            sets.push(set);
        }
        let add = |a: u64, b: u64| a.checked_add(b).ok_or(Error::InvalidTable);
        let mut ranges = Vec::new();
        let mut at = 0;
        for _ in 0..r.count()? {
            let start = add(at, r.number()?)?;
            at = add(start, r.number()?)?;
            ranges.push((start..at, sets[r.index(sets.len())?].clone()));
        }
        let mut markers = Vec::new();
        let mut address = 0;
        for _ in 0..r.count()? {
            address = add(address, r.number()?)?;
            let (feature, present, excluded) = (r.index(features.len())?, r.blob()?, r.blob()?);
            if present.len() != excluded.len() {
                return Err(Error::InvalidTable);
            }
            markers.push(Marker {
                address,
                feature,
                present,
                excluded,
            });
        }
        Ok(Self {
            features,
            ranges,
            markers,
        })
    }
}

#[cfg(feature = "tool")]
impl Table<'_> {
    pub(crate) fn write(&self) -> Vec<u8> {
        fn number(out: &mut Vec<u8>, mut value: u64) {
            while value >= 0x80 {
                out.push(value as u8 | 0x80);
                value >>= 7;
            }
            out.push(value as u8);
        }
        fn blob(out: &mut Vec<u8>, bytes: &[u8]) {
            number(out, bytes.len() as u64);
            out.extend_from_slice(bytes);
        }
        let mut out = MAGIC.to_vec();
        number(&mut out, self.features.len() as u64);
        for name in &self.features {
            blob(&mut out, name);
        }
        let mut sets: Vec<&Vec<usize>> = self.ranges.iter().map(|r| &r.1).collect();
        sets.sort_unstable();
        sets.dedup();
        number(&mut out, sets.len() as u64);
        for set in &sets {
            number(&mut out, set.len() as u64);
            for &feature in *set {
                number(&mut out, feature as u64);
            }
        }
        number(&mut out, self.ranges.len() as u64);
        let mut at = 0;
        for (range, set) in &self.ranges {
            number(&mut out, range.start - at);
            number(&mut out, range.end - range.start);
            number(
                &mut out,
                sets.binary_search(&set).expect("it is one of them") as u64,
            );
            at = range.end;
        }
        number(&mut out, self.markers.len() as u64);
        let mut address = 0;
        for marker in &self.markers {
            number(&mut out, marker.address - address);
            number(&mut out, marker.feature as u64);
            blob(&mut out, marker.present);
            blob(&mut out, marker.excluded);
            address = marker.address;
        }
        out
    }
}
