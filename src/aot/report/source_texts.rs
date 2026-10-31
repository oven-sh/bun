use std::sync::OnceLock;

use bun_sema::erasure::PackedTypeRanges;
use bun_sema::messages::Category;
use bun_sema_driver::{self as driver, TextLocator};

use crate::diagnostics::{SourcePosition, new_driver_diagnostic};
use crate::engine::Position;
use crate::ir::ids::{Id, ModuleId};

pub struct ModuleSource {
    // `ModulePaths::display_path`, which `ProgramNames::module_path` returns too.
    pub path: Box<[u8]>,
    text: StoredText,
    // `ModuleFragment::types_in_function_text`
    types_in_function_text: Option<PackedTypeRanges>,
}

// The texts of all modules stay alive while the engine runs, and messages name few of them.
enum StoredText {
    Plain(Box<[u8]>),
    Compressed {
        bytes: Box<[u8]>,
        length: usize,
        text: OnceLock<Box<[u8]>>,
    },
}

impl ModuleSource {
    pub fn new(path: &[u8], text: &[u8]) -> ModuleSource {
        ModuleSource {
            path: path.into(),
            text: StoredText::new(text),
            types_in_function_text: None,
        }
    }

    pub fn with_function_text(self, types_in_function_text: Option<PackedTypeRanges>) -> Self {
        ModuleSource {
            types_in_function_text,
            ..self
        }
    }

    pub fn len(&self) -> usize {
        match &self.text {
            StoredText::Plain(text) => text.len(),
            StoredText::Compressed { length, .. } => *length,
        }
    }

    pub fn function_text_len(&self) -> usize {
        let types = self.types_in_function_text.as_ref();
        types.map_or(0, |types| types.kept_len(self.len()))
    }

    /// `text()` keeps what it decompresses for the rest of the build. This does not.
    pub fn copy_function_text_to(&self, destination: &mut [u8]) {
        let Some(types) = &self.types_in_function_text else {
            return;
        };
        match &self.text {
            StoredText::Plain(text) => types.remove_from(text, destination),
            StoredText::Compressed { bytes, .. } => {
                let text = bun_zstd::decompress_alloc(bytes);
                let text = text.expect("the bytes come from `compress_append`");
                types.remove_from(&text, destination);
            }
        }
    }

    pub fn function_text(&self) -> Vec<u8> {
        let mut text = vec![0; self.function_text_len()];
        self.copy_function_text_to(&mut text);
        text
    }

    pub fn types_cut_from_function_text(&self) -> &[u8] {
        let types = self.types_in_function_text.as_ref();
        types.map_or(&[], PackedTypeRanges::as_bytes)
    }

    pub fn text(&self) -> &[u8] {
        match &self.text {
            StoredText::Plain(text) => text,
            StoredText::Compressed { bytes, text, .. } => text.get_or_init(|| {
                let text = bun_zstd::decompress_alloc(bytes);
                text.expect("the bytes come from `compress_append`")
                    .into_boxed_slice()
            }),
        }
    }
}

impl StoredText {
    const FASTEST_LEVEL: i32 = 1;

    fn new(text: &[u8]) -> StoredText {
        let mut bytes = Vec::with_capacity(bun_zstd::compress_bound(text.len()));
        match bun_zstd::compress_append(&mut bytes, text, Self::FASTEST_LEVEL) {
            // Not `into_boxed_slice`: the allocator leaves what shrinks to no less than half its size where it is.
            Ok(_) if bytes.len() < text.len() => StoredText::Compressed {
                bytes: bytes[..].into(),
                length: text.len(),
                text: OnceLock::new(),
            },
            Ok(_) | Err(_) => StoredText::Plain(text.into()),
        }
    }
}

#[derive(Default)]
pub struct SourceTexts {
    modules: Vec<Option<ModuleSource>>,
}

impl SourceTexts {
    pub fn new(modules: Vec<Option<ModuleSource>>) -> SourceTexts {
        SourceTexts { modules }
    }

    pub fn get(&self, module: ModuleId) -> Option<&ModuleSource> {
        self.modules.get(module.index())?.as_ref()
    }
}

pub struct ModuleLocator<'t> {
    texts: &'t SourceTexts,
    // By module. Positions come in the order of what they belong to, not of their modules, and a locator reads its whole text once.
    locators: Vec<Option<TextLocator<'t>>>,
}

impl<'t> ModuleLocator<'t> {
    pub fn new(texts: &'t SourceTexts) -> ModuleLocator<'t> {
        ModuleLocator {
            texts,
            locators: Vec::new(),
        }
    }

    pub fn locate(
        &mut self,
        position: Position,
        reported: driver::Diagnostic,
    ) -> driver::Diagnostic {
        let Some(source) = self.texts.get(position.module) else {
            return reported;
        };
        let locator = self.locator_of(position.module, source);
        locator.locate(position.offset, position.offset, reported)
    }

    pub fn position_of(&mut self, position: Position) -> Option<SourcePosition> {
        let (line, column) = self.line_and_column(position)?;
        let source = self.texts.get(position.module)?;
        Some(SourcePosition {
            path: source.path.to_vec(),
            line,
            column,
        })
    }

    pub fn has_text(&self, module: ModuleId) -> bool {
        self.texts.get(module).is_some()
    }

    pub fn line_and_column(&mut self, position: Position) -> Option<(u32, u32)> {
        let source = self.texts.get(position.module)?;
        let locator = self.locator_of(position.module, source);
        Some(locator.line_and_column(position.offset))
    }

    fn locator_of(&mut self, module: ModuleId, source: &'t ModuleSource) -> &TextLocator<'t> {
        let index = module.index();
        if self.locators.len() <= index {
            self.locators.resize_with(index + 1, || None);
        }
        self.locators[index].get_or_insert_with(|| TextLocator::new(&source.path, source.text()))
    }

    pub fn source_line(&mut self, position: Position) -> Vec<u8> {
        if !self.has_text(position.module) {
            return Vec::new();
        }
        let unlocated = new_driver_diagnostic(0, Category::Message, Vec::new(), &[]);
        let mut located = self.locate(position, unlocated);
        let index = located.line.saturating_sub(located.source_line) as usize;
        if index < located.source.len() {
            located.source.swap_remove(index)
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bstr::BString;

    fn texts() -> SourceTexts {
        let source =
            |path: &str, text: &str| Some(ModuleSource::new(path.as_bytes(), text.as_bytes()));
        SourceTexts::new(vec![
            source("/p/a.ts", "let a;\nconst \u{e9} = call();\n"),
            None,
            source("/p/b.ts", "b();"),
        ])
    }

    fn at(module: usize, offset: u32) -> Position {
        Position {
            module: ModuleId::new(module),
            offset,
        }
    }

    fn line_and_column(locator: &mut ModuleLocator<'_>, position: Position) -> Option<(u32, u32)> {
        let found = locator.position_of(position)?;
        Some((found.line, found.column))
    }

    #[test]
    fn columns_count_utf16_units() {
        let texts = texts();
        let mut locator = ModuleLocator::new(&texts);
        assert_eq!(line_and_column(&mut locator, at(0, 0)), Some((1, 1)));
        assert_eq!(line_and_column(&mut locator, at(0, 7)), Some((2, 1)));
        assert_eq!(line_and_column(&mut locator, at(0, 18)), Some((2, 11)));
    }

    #[test]
    fn locator_changes_modules() {
        let texts = texts();
        let mut locator = ModuleLocator::new(&texts);
        let path_at = |locator: &mut ModuleLocator<'_>, position| {
            locator
                .position_of(position)
                .map(|found| BString::from(found.path))
        };
        let first = path_at(&mut locator, at(0, 0));
        let second = path_at(&mut locator, at(2, 0));
        assert_ne!(first, second);
        assert_eq!(path_at(&mut locator, at(0, 3)), first);
    }

    #[test]
    fn module_without_text_has_no_position() {
        let texts = texts();
        let mut locator = ModuleLocator::new(&texts);
        assert_eq!(locator.position_of(at(1, 0)), None);
        assert_eq!(locator.position_of(at(9, 0)), None);
        assert!(locator.source_line(at(1, 0)).is_empty());
        let reported = new_driver_diagnostic(0, Category::Warning, b"x".to_vec(), &[]);
        assert!(locator.locate(at(1, 0), reported).path.is_empty());
    }

    #[test]
    fn source_line_contains_position() {
        let texts = texts();
        let mut locator = ModuleLocator::new(&texts);
        assert_eq!(BString::from(locator.source_line(at(0, 2))), "let a;");
        assert_eq!(BString::from(locator.source_line(at(2, 0))), "b();");
    }
}
