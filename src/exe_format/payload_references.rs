//! Checks a finished executable: the loader writes nothing into the payload and exports nothing from it.

mod elf;
mod macho;
mod pe;
#[cfg(test)]
mod tests;

use core::mem::size_of;

use crate::builtins::Image;
use crate::image::{AddressRange, ExecutableFormat, KnownSection};
use crate::read_struct;
use crate::section::{SectionError, find_known_section};

#[derive(Debug, Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum PayloadReferenceError {
    #[error("RelocationInPayload")]
    RelocationInPayload { address: u64 },
    #[error("DynamicSymbolInPayload")]
    DynamicSymbolInPayload { address: u64 },
    /// The executable has relocations in an encoding that this check does not read.
    #[error("UnsupportedRelocations")]
    UnsupportedRelocations,
    #[error("MalformedExecutable")]
    MalformedExecutable,
    #[error("NoPayload")]
    NoPayload,
}

impl PayloadReferenceError {
    pub fn name(self) -> &'static str {
        self.into()
    }

    pub fn address(self) -> Option<u64> {
        match self {
            PayloadReferenceError::RelocationInPayload { address }
            | PayloadReferenceError::DynamicSymbolInPayload { address } => Some(address),
            PayloadReferenceError::UnsupportedRelocations
            | PayloadReferenceError::MalformedExecutable
            | PayloadReferenceError::NoPayload => None,
        }
    }
}

impl From<SectionError> for PayloadReferenceError {
    fn from(error: SectionError) -> PayloadReferenceError {
        match error {
            SectionError::UnrecognizedExecutable | SectionError::MissingSection => {
                PayloadReferenceError::NoPayload
            }
            SectionError::Invalid => PayloadReferenceError::MalformedExecutable,
        }
    }
}

type Checked = Result<(), PayloadReferenceError>;

const MALFORMED: PayloadReferenceError = PayloadReferenceError::MalformedExecutable;
const POINTER_SIZE: u64 = 8;

/// The addresses of the payload, as the format counts them: virtual addresses, or offsets from the image base in a PE file.
#[derive(Copy, Clone)]
struct Payload(AddressRange);

impl Payload {
    /// Nothing of size 0 overlaps the first byte: a symbol for the end of what precedes the payload may have its address.
    fn overlaps(self, address: u64, size: u64) -> bool {
        address < self.0.end && address.saturating_add(size) > self.0.start
    }

    fn check_relocation(self, address: u64, size: u64) -> Checked {
        if self.overlaps(address, size) {
            return Err(PayloadReferenceError::RelocationInPayload { address });
        }
        Ok(())
    }

    fn check_dynamic_symbol(self, address: u64, size: u64) -> Checked {
        if self.overlaps(address, size) {
            return Err(PayloadReferenceError::DynamicSymbolInPayload { address });
        }
        Ok(())
    }
}

/// Reads the headers, the relocations and the dynamic symbols of `file`, never the payload itself.
pub fn check_payload_references(file: &mut Image<'_>) -> Result<(), PayloadReferenceError> {
    let location = find_known_section(file, KnownSection::Payload)?;
    let addresses =
        AddressRange::from_size(location.address, location.size).map_err(|_| MALFORMED)?;
    let payload = Payload(addresses);
    let magic = file.bytes(0, ExecutableFormat::MAGIC_SIZE)?;
    match ExecutableFormat::from_magic(&magic) {
        Some(ExecutableFormat::Elf) => elf::check(file, payload),
        Some(ExecutableFormat::MachO) => macho::check(file, payload),
        Some(ExecutableFormat::Pe) => pe::check(file, payload),
        None => Err(PayloadReferenceError::NoPayload),
    }
}

fn table_bytes(
    file: &mut Image<'_>,
    offset: u64,
    size: u64,
) -> Result<Vec<u8>, PayloadReferenceError> {
    let offset = usize::try_from(offset).map_err(|_| MALFORMED)?;
    let size = usize::try_from(size).map_err(|_| MALFORMED)?;
    Ok(file.bytes(offset, size)?)
}

fn struct_in<T: Copy>(bytes: &[u8], offset: usize) -> Result<T, PayloadReferenceError> {
    let end = offset.checked_add(size_of::<T>()).ok_or(MALFORMED)?;
    bytes.get(offset..end).map(read_struct).ok_or(MALFORMED)
}
