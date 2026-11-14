use bun_core::strings;
use bun_sema::erasure::PackedTypeRanges;
use bun_sema::messages::Category;
use bun_sema_driver::{self as driver, TextLocator};
use rustc_hash::FxHashMap;

use crate::diagnostics::{SourcePosition, new_driver_diagnostic};
use crate::engine::Position;
use crate::ir::StringTable;
use crate::ir::ids::{Id, ModuleId};
use crate::load::read_file_bytes;
use std::cell::UnsafeCell;
use std::ops::Range;
use std::sync::{Arc, OnceLock};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleOrigin {
    Program,
    Dependency,
    Runtime,
}

enum Text {
    Kept(Box<[u8]>),
    OnDisk {
        path_on_disk: Box<[u8]>,
        len: usize,
        hash: u64,
        read_again: OnceLock<Option<Box<[u8]>>>,
    },
}

/// The function sources of many modules in one block, which goes back to the system as soon as the engine has them.
#[derive(Default)]
pub struct FunctionSources(UnsafeCell<Box<[u8]>>);

// SAFETY: it only changes in `release`.
unsafe impl Sync for FunctionSources {}
// SAFETY: as a box of bytes.
unsafe impl Send for FunctionSources {}

impl FunctionSources {
    pub fn new(sources: Box<[u8]>) -> FunctionSources {
        FunctionSources(UnsafeCell::new(sources))
    }

    fn get(&self) -> &[u8] {
        // SAFETY: nothing reads them during `release`.
        unsafe { &*self.0.get() }
    }

    /// # Safety
    ///
    /// No other thread uses them, and nothing borrows them.
    unsafe fn release(&self) {
        // SAFETY: the caller's promise.
        unsafe { *self.0.get() = Box::default() };
    }
}

pub struct ModuleSource {
    pub path: Box<[u8]>,
    text: Text,
    erased_type_ranges: Option<PackedTypeRanges>,
    function_source: Option<(Arc<FunctionSources>, Range<usize>)>,
    origin: ModuleOrigin,
}

impl ModuleSource {
    pub fn new(path: &[u8], text: &[u8]) -> ModuleSource {
        ModuleSource {
            path: path.into(),
            text: Text::Kept(text.into()),
            erased_type_ranges: None,
            function_source: None,
            origin: ModuleOrigin::Program,
        }
    }

    pub fn new_on_disk(path: &[u8], path_on_disk: &[u8], text: &[u8]) -> ModuleSource {
        ModuleSource {
            text: Text::OnDisk {
                path_on_disk: path_on_disk.into(),
                len: text.len(),
                hash: StringTable::hash_of(text),
                read_again: OnceLock::new(),
            },
            ..ModuleSource::new(path, &[])
        }
    }

    pub fn with_function_source(self, erased_type_ranges: Option<PackedTypeRanges>) -> Self {
        ModuleSource {
            erased_type_ranges,
            ..self
        }
    }

    /// Its function source is `part` of `sources`.
    pub fn with_function_source_in(
        self,
        sources: &Arc<FunctionSources>,
        part: Range<usize>,
    ) -> Self {
        debug_assert_eq!(part.len(), self.function_source_len());
        ModuleSource {
            function_source: Some((Arc::clone(sources), part)),
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
            Text::OnDisk { read_again, .. } => {
                let text = read_again.get().and_then(Option::as_ref);
                text.map_or(0, |text| text.len())
            }
        }
    }

    pub fn function_source_len(&self) -> usize {
        let types = self.erased_type_ranges.as_ref();
        types.map_or(0, |types| types.kept_len(self.len()))
    }

    /// Nothing if it lies in no `FunctionSources`, or in one that is released.
    pub fn held_function_source(&self) -> Option<&[u8]> {
        let (sources, part) = self.function_source.as_ref()?;
        sources.get().get(part.clone())
    }

    pub fn copy_function_source_to(&self, destination: &mut [u8]) {
        if let Some(held) = self.held_function_source() {
            destination.copy_from_slice(held);
            return;
        }
        if self.erased_type_ranges.is_some()
            && let Some(text) = self.text()
        {
            self.remove_types_from(text, destination);
        }
    }

    /// `text` is the module's.
    pub fn remove_types_from(&self, text: &[u8], destination: &mut [u8]) {
        if let Some(types) = &self.erased_type_ranges {
            types.remove_from(text, destination);
        }
    }

    pub fn function_source(&self) -> Vec<u8> {
        let mut text = vec![0; self.function_source_len()];
        self.copy_function_source_to(&mut text);
        text
    }

    pub fn text(&self) -> Option<&[u8]> {
        match &self.text {
            Text::Kept(text) => Some(text),
            Text::OnDisk {
                path_on_disk,
                len,
                hash,
                read_again,
            } => {
                let is_as_compiled =
                    |text: &Vec<u8>| text.len() == *len && StringTable::hash_of(text) == *hash;
                let read = || Some(read_file_bytes(path_on_disk).filter(is_as_compiled)?.into());
                read_again.get_or_init(read).as_deref()
            }
        }
    }
}

#[derive(Default)]
pub struct SourceTexts {
    modules: Vec<Option<ModuleSource>>,
    function_sources: Arc<FunctionSources>,
    written_names: Vec<u8>,
}

impl SourceTexts {
    pub fn new(modules: Vec<Option<ModuleSource>>) -> SourceTexts {
        SourceTexts {
            modules,
            function_sources: Arc::default(),
            written_names: Vec::new(),
        }
    }

    pub fn with_function_sources(self, function_sources: Arc<FunctionSources>) -> SourceTexts {
        SourceTexts {
            function_sources,
            ..self
        }
    }

    /// # Safety
    ///
    /// No other thread uses the function sources, and nothing borrows one.
    pub unsafe fn release_function_sources(&self) {
        // SAFETY: the caller's promise.
        unsafe { self.function_sources.release() };
    }

    pub fn set_written_names(&mut self, names: Vec<u8>) {
        self.written_names = names;
    }

    pub fn written_names(&self) -> FxHashMap<&[u8], &[u8]> {
        let mut parts = strings::split(&self.written_names, b"\0");
        core::iter::from_fn(|| Some((parts.next()?, parts.next()?))).collect()
    }

    pub fn get(&self, module: ModuleId) -> Option<&ModuleSource> {
        self.modules.get(module.index())?.as_ref()
    }

    pub fn size_of_texts(&self) -> usize {
        let sources = self.modules.iter().flatten();
        let texts: usize = sources.map(ModuleSource::kept_len).sum();
        texts + self.function_sources.get().len()
    }

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
        match self.locator_of(position.module) {
            Some(locator) => locator.locate(position.offset, position.offset, reported),
            None => reported,
        }
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
        let source = self.texts.get(module);
        source.and_then(ModuleSource::text).is_some()
    }

    pub fn line_and_column(&mut self, position: Position) -> Option<(u32, u32)> {
        let locator = self.locator_of(position.module)?;
        Some(locator.line_and_column(position.offset))
    }

    fn locator_of(&mut self, module: ModuleId) -> Option<&TextLocator<'t>> {
        let source = self.texts.get(module)?;
        let text = source.text()?;
        let index = module.index();
        if self.locators.len() <= index {
            self.locators.resize_with(index + 1, || None);
        }
        Some(self.locators[index].get_or_insert_with(|| TextLocator::new(&source.path, text)))
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
            .with_function_source(types())
            .with_origin(ModuleOrigin::Runtime);
        let origin_first = ModuleSource::new(b"node:fs", b"a;")
            .with_origin(ModuleOrigin::Runtime)
            .with_function_source(types());
        for source in [origin_last, origin_first] {
            assert_eq!(source.origin(), ModuleOrigin::Runtime);
            assert_eq!(BString::from(source.function_source()), "a;");
        }
    }

    #[test]
    fn long_text_that_repeats_itself_is_read_back_byte_for_byte() {
        let text = b"const value = call(1, 2, 3);\n".repeat(4096);
        let source = ModuleSource::new(b"/p/long.js", &text)
            .with_function_source(Some(PackedTypeRanges::default()));
        assert_eq!(source.len(), text.len());
        assert_eq!(source.function_source_len(), text.len());
        assert!(source.text() == Some(&text[..]));
        assert!(source.function_source() == text);
    }

    #[test]
    fn module_without_function_source_is_not_read_again() {
        let file = std::env::temp_dir().join(format!("aot-read-again-{}.ts", std::process::id()));
        std::fs::write(&file, b"a();").unwrap();
        let path = from_native(file.as_os_str().as_encoded_bytes());
        let source = ModuleSource::new_on_disk(b"/p/a.ts", &path, b"a();");
        assert!(source.function_source().is_empty());
        std::fs::write(&file, b"b();").unwrap();
        let text = source.text().map(<[u8]>::to_vec);
        std::fs::remove_file(&file).unwrap();
        assert_eq!(text, None);
    }

    #[test]
    fn released_function_source_is_unavailable() {
        let sources = Arc::new(FunctionSources::new(Box::from(*b"a();b();")));
        let source = |path: &str, text: &str, part: Range<usize>| {
            let source = ModuleSource::new(path.as_bytes(), text.as_bytes());
            let source = source.with_function_source(Some(PackedTypeRanges::default()));
            Some(source.with_function_source_in(&sources, part))
        };
        let modules = vec![
            source("/p/a.ts", "a();", 0..4),
            source("/p/b.ts", "b();", 4..8),
        ];
        let texts = SourceTexts::new(modules).with_function_sources(Arc::clone(&sources));
        let second = texts.get(ModuleId::new(1)).unwrap();
        assert_eq!(texts.size_of_texts(), 16);
        assert_eq!(second.held_function_source(), Some(&b"b();"[..]));
        assert_eq!(BString::from(second.function_source()), "b();");

        // SAFETY: this is the only thread, and nothing is borrowed.
        unsafe { texts.release_function_sources() };
        assert_eq!(texts.size_of_texts(), 8);
        assert_eq!(second.held_function_source(), None);
        assert_eq!(BString::from(second.function_source()), "b();");
    }

    #[test]
    fn function_source_defaults_to_empty() {
        let source = ModuleSource::new(b"/p/a.ts", b"a();");
        assert_eq!(source.function_source_len(), 0);
        assert!(source.function_source().is_empty());
        let mut destination = *b"kept";
        source.copy_function_source_to(&mut destination);
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
        let on_disk = || ModuleSource::new_on_disk(b"/p/a.ts", &path_on_disk, b"let a;\nb();\n");

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

        for edited in ["let a;\n", "let b;\na();\n"] {
            std::fs::write(&path, edited).expect("the file is written again");
            assert_eq!(on_disk().text(), None, "{edited:?}");
        }
        let texts = SourceTexts::new(vec![Some(on_disk())]);
        let mut locator = ModuleLocator::new(&texts);
        assert_eq!(locator.line_and_column(at(0, 7)), None);
        assert_eq!(BString::from(locator.source_line(at(0, 8))), "");
        std::fs::remove_file(&path).expect("the file is there");
        assert_eq!(on_disk().text(), None);
    }
}
