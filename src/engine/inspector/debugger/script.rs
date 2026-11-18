//! The sources that a frontend has been told of.

use core::cell::{OnceCell, RefCell};
use core::ops::Range;
use core::sync::atomic::{AtomicU64, Ordering};

use bun_engine_syntax::{PauseKind, PausePosition};
use bun_engine_text::{StringRef, Text};
use bun_engine_vm::{
    Message, SourceProvider, SourceProviderRef, SourceType, Vm, WasmModuleDescription,
};

use crate::call_stack::script_id_text;
use crate::protocol::{Object, object};

/// From zero.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct Position {
    pub(crate) line: i32,
    pub(crate) column: i32,
}

impl Position {
    fn of(provider: &SourceProvider, offset: u32) -> Position {
        let position = provider.position_in_document(offset);
        Position {
            line: position.line as i32 - 1,
            column: position.column as i32 - 1,
        }
    }
}

/// `Debugger.Location`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Location {
    pub(crate) script: usize,
    pub(crate) position: Position,
}

impl Location {
    pub(crate) const NOWHERE: Location = Location {
        script: 0,
        position: Position {
            line: -1,
            column: -1,
        },
    };

    pub(crate) fn of(provider: &SourceProvider, offset: u32) -> Location {
        Location {
            script: provider.id(),
            position: Position::of(provider, offset),
        }
    }

    pub(crate) fn to_json(self) -> Object {
        object! {
            "scriptId": script_id_text(self.script),
            "lineNumber": self.position.line,
            "columnNumber": self.position.column,
        }
    }
}

pub(crate) struct Script {
    provider: SourceProviderRef,
    source_url: Option<StringRef>,
    source_map_url: Option<StringRef>,
    display_name: Option<StringRef>,
    end: Position,
    pauses: OnceCell<Vec<PausePosition>>,
    pub(super) blackboxed_ranges: RefCell<Vec<Range<Position>>>,
}

impl Script {
    pub(super) fn new(provider: &SourceProvider) -> Script {
        let (text, line_feed) = (provider.text(), u16::from(b'\n'));
        let (line, column) = provider.start_position();
        let end = match text.rfind_unit(line_feed, text.len()) {
            Some(last) => Position {
                line: line.wrapping_add(text.count_unit(line_feed) as i32),
                column: (text.len() - last - 1) as i32,
            },
            None => Position {
                line,
                column: column.wrapping_add(text.len() as i32),
            },
        };
        Script {
            provider: SourceProviderRef::retain(provider),
            source_url: provider.source_url_directive(),
            source_map_url: provider.source_mapping_url_directive(),
            display_name: None,
            end,
            pauses: OnceCell::new(),
            blackboxed_ranges: RefCell::default(),
        }
    }

    /// It has no text, and columns are offsets in the module.
    pub(super) fn for_wasm(module: WasmModuleDescription) -> Script {
        static LAST_NUMBER: AtomicU64 = AtomicU64::new(0);
        let number = LAST_NUMBER.fetch_add(1, Ordering::Relaxed) + 1;
        let url = format_args!("webassembly:///{number}.wasm").into_string();
        let provider =
            SourceProvider::build(StringRef::empty(), Some(url), SourceType::WebAssembly);
        Script {
            source_map_url: Some(module.source_map_url),
            display_name: Some(module.name),
            end: Position {
                line: 0,
                column: module.end_of_code as i32,
            },
            ..Script::new(&provider.finish())
        }
    }

    pub(crate) fn id(&self) -> usize {
        self.provider.id()
    }

    pub(crate) fn source(&self) -> &StringRef {
        self.provider.source()
    }

    fn start(&self) -> Position {
        let (line, column) = self.provider.start_position();
        Position { line, column }
    }

    pub(super) fn whole(&self) -> Range<Position> {
        let column = self.end.column.saturating_add(1);
        self.start()..Position { column, ..self.end }
    }

    pub(super) fn url(&self) -> Text<'_> {
        self.provider.url().map_or(Text::EMPTY, |it| it.text())
    }

    pub(super) fn source_url(&self) -> Text<'_> {
        self.source_url.as_ref().map_or(Text::EMPTY, |it| it.text())
    }

    pub(super) fn url_for_breakpoints(&self) -> Text<'_> {
        match self.source_url() {
            url if url.is_empty() => self.url(),
            url => url,
        }
    }

    pub(crate) fn is_webassembly(&self) -> bool {
        self.provider.source_type() == SourceType::WebAssembly
    }

    /// The parameters of `Debugger.scriptParsed`.
    pub(super) fn to_json(&self, realm: i32) -> Object {
        let script_type = match self.provider.source_type() {
            SourceType::Module | SourceType::AnalyzedModule | SourceType::Synthetic => "module",
            SourceType::WebAssembly => "webassembly",
            _ => "program",
        };
        object! {
            "scriptId": script_id_text(self.id()),
            "url": self.provider.url().cloned().unwrap_or_default(),
            "startLine": self.start().line,
            "startColumn": self.start().column,
            "endLine": self.end.line,
            "endColumn": self.end.column,
            "executionContextId": realm,
            "scriptType": script_type,
            "isContentScript": false,
            "sourceURL" => self.source_url.as_ref(),
            "sourceMapURL" => self.source_map_url.as_ref(),
            "displayName" => self.display_name.as_ref(),
        }
    }

    fn offset_of(&self, position: Position) -> u32 {
        let start = self.start();
        let Ok(line) = u32::try_from(i64::from(position.line) - i64::from(start.line)) else {
            return 0;
        };
        let column = match line {
            0 => position.column.saturating_sub(start.column).max(0),
            _ => position.column,
        };
        (self.provider.lines()).offset_of(self.provider.text(), line, column as u32)
    }

    fn pauses(&self, vm: &Vm) -> &[PausePosition] {
        (self.pauses).get_or_init(|| vm.pause_positions(&self.provider))
    }

    fn pauses_from(&self, vm: &Vm, offset: u32) -> &[PausePosition] {
        let pauses = self.pauses(vm);
        &pauses[pauses.partition_point(|it| it.offset < offset)..]
    }

    /// Where a breakpoint at `offset` stops. It goes into a function that starts on its line, and past any other.
    fn resolve_offset(&self, offset: u32, ahead: &[PausePosition]) -> Option<u32> {
        let (first, rest) = ahead.split_first()?;
        if first.kind != PauseKind::Enter {
            return Some(first.offset);
        }
        if first.offset == offset {
            let inside = rest.iter().find(|it| it.kind != PauseKind::Enter);
            return inside.map(|it| it.offset);
        }
        let line_of = |offset| self.provider.position_in_text(offset).line;
        let mut skipped = u32::from(line_of(first.offset) != line_of(offset));
        for pause in rest {
            match pause.kind {
                PauseKind::Enter => skipped += 1,
                _ if skipped == 0 => return Some(pause.offset),
                PauseKind::Leave => skipped -= 1,
                PauseKind::Pause => {}
            }
        }
        None
    }

    pub(super) fn resolve(&self, vm: &Vm, position: Position) -> Option<Location> {
        if !(self.start().line..=self.end.line).contains(&position.line) {
            return None;
        }
        let offset = self.offset_of(position);
        let resolved = self.resolve_offset(offset, self.pauses_from(vm, offset))?;
        Some(Location::of(&self.provider, resolved))
    }

    pub(crate) fn breakpoint_locations(&self, vm: &Vm, range: Range<Position>) -> Vec<Location> {
        let end = self.offset_of(range.end);
        let ahead = self.pauses_from(vm, self.offset_of(range.start));
        let in_range = ahead.iter().take_while(|it| it.offset < end);
        let pauses = in_range.filter(|it| it.kind != PauseKind::Enter);
        let mut offsets: Vec<u32> = pauses.map(|it| it.offset).collect();
        offsets.dedup();
        let location = |&offset| Location::of(&self.provider, offset);
        offsets.iter().map(location).collect()
    }
}
