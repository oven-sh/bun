use bun_sema::erasure::PackedTypeRanges;
use bun_sema::messages::Category;
use bun_sema_driver::{self as driver, TextLocator};

use crate::diagnostics::{SourcePosition, new_driver_diagnostic};
use crate::engine::Position;
use crate::ir::ids::{Id, ModuleId};
use crate::load::read_file_bytes;
use std::sync::OnceLock;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleOrigin {
    Program,
    Dependency,
    Runtime,
}

enum Text {
    // A copy: the session that owns what the load has read is freed in front of the engine, and reports come behind it.
    Kept(Box<[u8]>),
    // The file held these very bytes when the program was linked. Few builds ever show a line of a file, and the texts of a large program are hundreds of
    // megabytes under the engine's summit, so whoever asks first reads the file again.
    OnDisk {
        path_on_disk: Box<[u8]>,
        len: usize,
        read_again: OnceLock<Box<[u8]>>,
    },
}

pub struct ModuleSource {
    // `Sources::diagnostic_path`
    pub path: Box<[u8]>,
    text: Text,
    // `ModuleFragment::types_in_function_text`
    types_in_function_text: Option<PackedTypeRanges>,
    origin: ModuleOrigin,
}

impl ModuleSource {
    pub fn new(path: &[u8], text: &[u8]) -> ModuleSource {
        ModuleSource {
            path: path.into(),
            text: Text::Kept(text.into()),
            types_in_function_text: None,
            origin: ModuleOrigin::Program,
        }
    }

    /// `path_on_disk`: for `read_file_bytes`, which gives the `len` bytes of the text now.
    pub fn new_on_disk(path: &[u8], path_on_disk: &[u8], len: usize) -> ModuleSource {
        ModuleSource {
            text: Text::OnDisk {
                path_on_disk: path_on_disk.into(),
                len,
                read_again: OnceLock::new(),
            },
            ..ModuleSource::new(path, &[])
        }
    }

    pub fn with_function_text(self, types_in_function_text: Option<PackedTypeRanges>) -> Self {
        ModuleSource {
            types_in_function_text,
            ..self
        }
    }

    pub fn with_origin(self, origin: ModuleOrigin) -> Self {
        ModuleSource { origin, ..self }
    }

    pub fn origin(&self) -> ModuleOrigin {
        self.origin
    }

    pub fn len(&self) -> usize {
        match &self.text {
            Text::Kept(text) => text.len(),
            Text::OnDisk { len, .. } => *len,
        }
    }

    fn kept_len(&self) -> usize {
        match &self.text {
            Text::Kept(text) => text.len(),
            Text::OnDisk { read_again, .. } => read_again.get().map_or(0, |text| text.len()),
        }
    }

    pub fn function_text_len(&self) -> usize {
        let types = self.types_in_function_text.as_ref();
        types.map_or(0, |types| types.kept_len(self.len()))
    }

    /// `destination` has room for `function_text_len()`.
    pub fn copy_function_text_to(&self, destination: &mut [u8]) {
        if let Some(types) = &self.types_in_function_text {
            types.remove_from(self.text(), destination);
        }
    }

    pub fn function_text(&self) -> Vec<u8> {
        let mut text = vec![0; self.function_text_len()];
        self.copy_function_text_to(&mut text);
        text
    }

    pub fn text(&self) -> &[u8] {
        match &self.text {
            Text::Kept(text) => text,
            Text::OnDisk {
                path_on_disk,
                len,
                read_again,
            } => read_again.get_or_init(|| {
                let text = read_file_bytes(path_on_disk).filter(|text| text.len() == *len);
                // The file has gone or changed while the program was built. Every position still lies in the text: in its one line of blanks.
                text.unwrap_or_else(|| vec![b' '; *len]).into()
            }),
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

    /// The bytes of text that stay alive while the engine runs.
    pub fn size_of_texts(&self) -> usize {
        let sources = self.modules.iter().flatten();
        sources.map(ModuleSource::kept_len).sum()
    }

    /// A module without a source counts as one of Bun's own: no report for users lists it.
    pub fn origin(&self, module: ModuleId) -> ModuleOrigin {
        let source = self.get(module);
        source.map_or(ModuleOrigin::Runtime, ModuleSource::origin)
    }

    pub fn path(&self, module: ModuleId) -> &[u8] {
        match self.get(module) {
            Some(source) => &source.path,
            None => &[],
        }
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
    use bun_sema_driver::host::from_native;

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
    fn new_source_has_program_origin() {
        let source = ModuleSource::new(b"/p/a.ts", b"a;");
        assert_eq!(source.origin(), ModuleOrigin::Program);
    }

    #[test]
    fn builders_keep_what_the_other_set() {
        let types = || Some(PackedTypeRanges::default());
        let origin_last = ModuleSource::new(b"node:fs", b"a;")
            .with_function_text(types())
            .with_origin(ModuleOrigin::Runtime);
        let origin_first = ModuleSource::new(b"node:fs", b"a;")
            .with_origin(ModuleOrigin::Runtime)
            .with_function_text(types());
        for source in [origin_last, origin_first] {
            assert_eq!(source.origin(), ModuleOrigin::Runtime);
            assert_eq!(BString::from(source.function_text()), "a;");
        }
    }

    #[test]
    fn long_text_that_repeats_itself_is_read_back_byte_for_byte() {
        let text = b"const value = call(1, 2, 3);\n".repeat(4096);
        let source = ModuleSource::new(b"/p/long.js", &text)
            .with_function_text(Some(PackedTypeRanges::default()));
        assert_eq!(source.len(), text.len());
        assert_eq!(source.function_text_len(), text.len());
        assert!(source.text() == text);
        assert!(source.function_text() == text);
    }

    #[test]
    fn source_without_function_text_writes_nothing() {
        let source = ModuleSource::new(b"/p/a.ts", b"a();");
        assert_eq!(source.function_text_len(), 0);
        assert!(source.function_text().is_empty());
        let mut destination = *b"kept";
        source.copy_function_text_to(&mut destination);
        assert_eq!(&destination, b"kept");
    }

    #[test]
    fn texts_are_as_large_as_the_texts_of_their_modules() {
        assert_eq!(SourceTexts::default().size_of_texts(), 0);
        assert_eq!(SourceTexts::new(vec![None]).size_of_texts(), 0);
        let first = "let a;\nconst \u{e9} = call();\n".len();
        assert_eq!(texts().size_of_texts(), first + "b();".len());
    }

    #[test]
    fn origin_and_path_are_those_of_the_source() {
        let program = ModuleSource::new(b"/p/a.ts", b"a();");
        let dependency = ModuleSource::new(b"/p/node_modules/b/b.js", b"b();")
            .with_origin(ModuleOrigin::Dependency);
        let texts = SourceTexts::new(vec![Some(program), Some(dependency)]);
        let (first, second) = (ModuleId::new(0), ModuleId::new(1));
        assert_eq!(texts.origin(first), ModuleOrigin::Program);
        assert_eq!(texts.origin(second), ModuleOrigin::Dependency);
        assert_eq!(BString::from(texts.path(first)), "/p/a.ts");
        assert_eq!(BString::from(texts.path(second)), "/p/node_modules/b/b.js");
    }

    #[test]
    fn module_without_source_has_runtime_origin_and_no_path() {
        let texts = texts();
        for module in [1, 9].map(ModuleId::new) {
            assert_eq!(texts.origin(module), ModuleOrigin::Runtime);
            assert!(texts.path(module).is_empty());
        }
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

    #[test]
    fn text_on_disk_is_read_by_the_first_who_asks() {
        let name = format!("bun-aot-source-text-{}.ts", std::process::id());
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, "let a;\nb();\n")
            .expect("the folder for temporary files takes a file");
        let path_on_disk = from_native(path.to_str().expect("the path is text").as_bytes());
        let on_disk = || ModuleSource::new_on_disk(b"/p/a.ts", &path_on_disk, 12);

        let texts = SourceTexts::new(vec![Some(on_disk())]);
        assert_eq!(
            (
                texts.size_of_texts(),
                texts.get(ModuleId::new(0)).map(ModuleSource::len)
            ),
            (0, Some(12))
        );
        let mut locator = ModuleLocator::new(&texts);
        assert_eq!(locator.line_and_column(at(0, 7)), Some((2, 1)));
        assert_eq!(BString::from(locator.source_line(at(0, 8))), "b();");
        assert_eq!(texts.size_of_texts(), 12);

        // A file that has changed or gone gives no line, and every position stays inside the text.
        std::fs::write(&path, "let a;\n").expect("the file is written again");
        assert_eq!(on_disk().text(), [b' '; 12]);
        std::fs::remove_file(&path).expect("the file is there");
        assert_eq!(on_disk().text(), [b' '; 12]);
    }
}
