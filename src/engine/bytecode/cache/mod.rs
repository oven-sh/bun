//! The serialized form of code.
//!
//! A payload consists of [`Region`]s. It has one entry or many: a script, a module or a built-in function, each with
//! the code of the functions inside, which is decoded when it is first asked for. It has no hash of itself: whoever
//! stores it where it can be damaged adds one.

mod format;
mod link;
mod load;
mod records;
mod strings;

use std::sync::Arc;

use bun_engine_syntax::FunctionKind;
use bun_engine_text::StringRef;

use crate::bytes::Reader;
use crate::function::{FunctionInfo, Origin};
use crate::host::Host;

pub use link::{Digest, Encoder, Hints, Linked, OrderNames, Output, Region};
pub(crate) use load::{CachedCode, Unit};
pub use load::{CachedLines, Embedding, EntryId, Loaded, Loader, Observer};
pub use records::{Root, Unencodable};
pub use strings::{StringTableBuilder, order_hash};

enum Memory {
    Embedded(&'static [u8]),
    Lasting(&'static [u8]),
    Owned(Box<[u8]>),
}

#[derive(Clone)]
pub struct Payload(Arc<Memory>);

impl Payload {
    /// For what is part of the executable, and as trusted as that. Only the pages that are needed are read.
    pub fn embedded(bytes: &'static [u8]) -> Payload {
        Payload(Arc::new(Memory::Embedded(bytes)))
    }

    /// For what has the hash that was stored with it. Its code is verified as it is decoded.
    pub fn intact(bytes: Box<[u8]>) -> Payload {
        Payload(Arc::new(Memory::Owned(bytes)))
    }

    /// The same.
    pub fn intact_and_lasting(bytes: &'static [u8]) -> Payload {
        Payload(Arc::new(Memory::Lasting(bytes)))
    }

    #[inline]
    pub fn is_embedded(&self) -> bool {
        matches!(*self.0, Memory::Embedded(_))
    }

    #[inline]
    pub(crate) fn bytes(&self) -> &[u8] {
        match &*self.0 {
            Memory::Embedded(bytes) | Memory::Lasting(bytes) => bytes,
            Memory::Owned(bytes) => bytes,
        }
    }

    fn static_bytes(&self) -> Option<&'static [u8]> {
        match *self.0 {
            Memory::Embedded(bytes) | Memory::Lasting(bytes) => Some(bytes),
            Memory::Owned(_) => None,
        }
    }

    /// The bytes after their number. Nothing is at zero.
    #[inline]
    pub(crate) fn blob(&self, at: u32) -> Option<&[u8]> {
        if at == 0 {
            return Some(&[]);
        }
        Reader::new(self.bytes().get(at as usize..)?).blob()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Goal {
    Script,
    Module,
    Builtin,
}

/// All that the code of an entry depends on.
#[derive(Clone, Copy)]
pub struct Key<'a> {
    pub source: &'a StringRef,
    pub goal: Goal,
    /// Stands for the characters of the source. `None` takes the word of an embedded payload, and reads no text.
    pub identity: Option<u64>,
}

impl<'a> Key<'a> {
    /// What an entry starts with.
    pub const BYTES: usize = 17;
    const IDENTITY_AT: usize = 9;

    pub fn of_program(source: &'a StringRef, goal: Goal) -> Key<'a> {
        let identity = Some(source.text().fingerprint());
        Key {
            source,
            goal,
            identity,
        }
    }

    /// `stamp` stands for the text.
    pub fn of_builtin(source: &'a StringRef, stamp: u32, host: &dyn Host) -> Key<'a> {
        Key {
            source,
            goal: Goal::Builtin,
            identity: Some(u64::from(host.version()) << 32 | u64::from(stamp)),
        }
    }

    fn bytes(&self) -> [u8; Key::BYTES] {
        let mut bytes = [self.goal as u8; Key::BYTES];
        bytes[..4].copy_from_slice(&format::VERSION.to_le_bytes());
        bytes[5..Key::IDENTITY_AT].copy_from_slice(&(self.source.len() as u32).to_le_bytes());
        bytes[Key::IDENTITY_AT..].copy_from_slice(&self.identity.unwrap_or(0).to_le_bytes());
        bytes
    }

    /// Whether the entry that starts with these bytes is for this key. Decodes nothing.
    pub fn opens(&self, entry: &[u8]) -> bool {
        let compared = self.identity.map_or(Key::IDENTITY_AT, |_| Key::BYTES);
        entry.len() >= Key::BYTES && entry.starts_with(&self.bytes()[..compared])
    }
}

/// Which of the functions that may start at one place.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum FunctionRole {
    Written = 0,
    FieldInitializer = 2,
    DefaultConstructor = 3,
}

/// Tells a function from the others of its source.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct FunctionKey {
    /// Of its parameters, of the first element that it initializes, of its class.
    pub start: u32,
    pub role: FunctionRole,
}

impl FunctionKey {
    fn of(function: &FunctionInfo) -> Option<FunctionKey> {
        let (start, role) = if function.origin.contains(Origin::DEFAULT_CONSTRUCTOR) {
            (function.text.start, FunctionRole::DefaultConstructor)
        } else if function.kind == FunctionKind::FieldInitializer {
            let first = function.fields.as_ref()?.sources.first()?;
            (first.start, FunctionRole::FieldInitializer)
        } else {
            (function.parameters_start, FunctionRole::Written)
        };
        Some(FunctionKey { start, role })
    }
}
