//! Positions for the program, which counts in UTF-16 code units of the text it's given, without the byte order mark.
//!
//! That text is the file's, or for a Svelte component, the component's: rules see svelte-eslint-parser's ESTree with
//! component positions ([`crate::estree`]'s `svelte.rs`). The component program's nodes, tokens and references are
//! placed in the component by its [view](View).

use crate::ast::File;
use crate::ast::view::View;
use bun_core::strings::Utf16OffsetTable;

pub(super) struct Units<'v> {
    table: Utf16OffsetTable,
    view: Option<&'v View>,
}

impl<'v> Units<'v> {
    /// For `file`, whose text the program gets, or the text of the component whose program it is.
    pub(super) fn of<'a: 'v>(file: &'a File<'a>) -> Units<'v> {
        match (file.svelte(), file.view()) {
            (Some(component), Some(view)) => Units {
                table: Utf16OffsetTable::without_bom(component.text()),
                view: Some(view),
            },
            _ => Units {
                table: Utf16OffsetTable::without_bom(file.text()),
                view: None,
            },
        }
    }

    /// True if the text is a component's.
    #[inline]
    pub(super) fn is_in_component(&self) -> bool {
        self.view.is_some()
    }

    /// The position of the file byte at `offset`, where a node, a token or a comment starts.
    #[inline]
    pub(super) fn to_utf16(&self, offset: u32) -> u32 {
        match self.view {
            None => self.table.to_utf16(offset),
            Some(view) => self.table.to_utf16(view.in_file(offset)),
        }
    }

    /// The end position of something that starts at `start` in the file and ends at `end`.
    #[inline]
    pub(super) fn end_to_utf16(&self, start: u32, end: u32) -> u32 {
        match self.view {
            None => self.table.to_utf16(end),
            Some(_) if end <= start => self.to_utf16(start),
            // The last byte inside it, at its source position, because what follows can be glue.
            Some(view) => self.table.to_utf16(view.in_file(end - 1) + 1),
        }
    }

    /// The position of the byte at `offset` in the text the program gets.
    #[inline]
    pub(super) fn text_to_utf16(&self, offset: u32) -> u32 {
        self.table.to_utf16(offset)
    }

    /// The byte offset in the text the program gets.
    #[inline]
    pub(super) fn to_bytes(&self, units: u32) -> u32 {
        self.table.to_bytes(units)
    }
}
