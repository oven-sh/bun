//! The options, as they are in a configuration file.

use super::SortImports;
use std::sync::Arc;

/// The options that are about imports, by name, with their values as they are written in JSON, a
/// string without its quotes.
#[derive(Debug, Default, Clone, PartialEq, Eq, Hash)]
pub struct Settings {
    entries: Vec<(Box<[u8]>, Box<[u8]>)>,
}

impl Settings {
    /// Takes the option `name` if it is about imports. A later value replaces an earlier one.
    pub fn set(&mut self, name: &[u8], value: &[u8]) -> bool {
        let is_known = name.starts_with(b"importOrder") || matches!(name, b"plugins" | b"sortImports" | b"experimentalSortImports");
        if is_known {
            self.entries.retain(|entry| &*entry.0 != name);
            self.entries.push((name.into(), value.into()));
        }
        is_known
    }

    /// `None`: imports are left as they are. `Err`: what is wrong, for the user.
    pub fn compile(&self) -> Result<Option<Arc<SortImports>>, Vec<u8>> {
        Ok((!self.entries.is_empty()).then(|| Arc::new(SortImports { is_enabled: true })))
    }
}
