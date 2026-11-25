//! Writes the segments before and between scans (jcmarker.c).

use crate::huffman::Spec;
use crate::marker::{DHT, SOS};
use crate::{Error, Result};

pub(crate) fn write_segment(out: &mut Vec<u8>, marker: u8, parts: &[&[u8]]) -> Result<()> {
    let len = 2 + parts.iter().map(|part| part.len()).sum::<usize>();
    out.try_reserve(2 + len)?;
    out.extend_from_slice(&[0xFF, marker]);
    out.extend_from_slice(&(len as u16).to_be_bytes());
    parts.iter().for_each(|part| out.extend_from_slice(part));
    Ok(())
}

/// To be added to the number of a table for AC coefficients.
pub(crate) const AC_CLASS: u8 = 0x10;

pub(crate) fn write_huffman_table(out: &mut Vec<u8>, number: u8, spec: &Spec) -> Result<()> {
    let symbols = spec.symbols.get(..spec.len()).ok_or(Error::Internal)?;
    write_segment(out, DHT, &[&[number], &spec.counts, symbols])
}

/// `components` have an id and the numbers of their tables.
pub(crate) fn write_scan_header(
    out: &mut Vec<u8>,
    components: &[[u8; 2]],
    ss_se_ah_al: [u8; 3],
) -> Result<()> {
    let count = [components.len() as u8];
    let parts = [&count, components.as_flattened(), &ss_se_ah_al];
    write_segment(out, SOS, &parts)
}
