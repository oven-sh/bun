use std::sync::OnceLock;

use bun_sema::messages::Category;
use bun_sema_driver::{self as driver, TextLocator};

use crate::diagnostics::{SourcePosition, new_driver_diagnostic};
use crate::engine::Position;
use crate::ir::ids::{Id, ModuleId};

pub struct ModuleSource {
    // `ModulePaths::display_path`, which `ProgramNames::module_path` returns too.
    pub path: Box<[u8]>,
    text: StoredText,
}

// The texts of all modules stay alive while the engine runs, and messages name few of them.
enum StoredText {
    Plain(Box<[u8]>),
    Compressed {
        bytes: Box<[u8]>,
        text: OnceLock<Box<[u8]>>,
    },
}

impl ModuleSource {
    pub fn new(path: &[u8], text: &[u8]) -> ModuleSource {
        ModuleSource {
            path: path.into(),
            text: StoredText::new(text),
        }
    }

    pub fn text(&self) -> &[u8] {
        match &self.text {
            StoredText::Plain(text) => text,
            StoredText::Compressed { bytes, text } => text.get_or_init(|| {
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
        match bun_zstd::compress_append(&mut bytes, text, Some(Self::FASTEST_LEVEL)) {
            bun_zstd::Result::Success(_) if bytes.len() < text.len() => StoredText::Compressed {
                bytes: bytes.into_boxed_slice(),
                text: OnceLock::new(),
            },
            bun_zstd::Result::Success(_) | bun_zstd::Result::Err(_) => {
                StoredText::Plain(text.into())
            }
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
        let Some(mut located) = self.locate_position(position) else {
            return Vec::new();
        };
        let index = located.line.saturating_sub(located.source_line) as usize;
        if index < located.source.len() {
            located.source.swap_remove(index)
        } else {
            Vec::new()
        }
    }

    fn locate_position(&mut self, position: Position) -> Option<driver::Diagnostic> {
        self.texts.get(position.module)?;
        let unlocated = new_driver_diagnostic(0, Category::Message, Vec::new(), &[]);
        Some(self.locate(position, unlocated))
    }
}
