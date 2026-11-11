use bun_options_types::aot_options::AotOptions;
use bun_trim::{UsedFeatures, UsedLocales};

use super::{ModuleOrigin, ModuleSource, ReportInput, SourceTexts};
use crate::engine::testing::ResultRecords;
use crate::engine::{
    FunctionNameRecord, LayoutNameRecord, Position, SourceLocation, TextRange, Witness,
};
use crate::ir::ids::{ABSENT_WORD, ModuleId};
use crate::statistics::Statistics;

pub(super) const PROGRAM: u32 = 0;
pub(super) const DEPENDENCY: u32 = 1;
pub(super) const RUNTIME: u32 = 2;
pub(super) const NO_LOCATION: SourceLocation = SourceLocation {
    module: ABSENT_WORD,
    position: 0,
};

const PROGRAM_PATH: &[u8] = b"src/a.ts";
const PROGRAM_TEXT: &[u8] = b"let first = 1;\nlet second = first.size;\nexport {};\n";
pub(super) const LINE_1_COLUMN_5: u32 = 4;
pub(super) const LINE_2_COLUMN_14: u32 = 28;
const DEPENDENCY_PATH: &[u8] = b"node_modules/b/b.js";
const DEPENDENCY_TEXT: &[u8] = b"module.exports = {};\n";
const RUNTIME_PATH: &[u8] = b"node:fs";

const FUNCTIONS: [(u32, u32, &[u8]); 2] = [(0, PROGRAM, b"double"), (1, RUNTIME, b"readFile")];
const LAYOUTS: [(u32, &[u8]); 2] = [(0, b"Item"), (1, b"Order")];

pub(super) fn location(module: u32, position: u32) -> SourceLocation {
    SourceLocation { module, position }
}

pub(super) fn at(module: u32, offset: u32) -> Option<Position> {
    Some(Position {
        module: ModuleId::from_word(module),
        offset,
    })
}

pub(super) fn witness(function: u32, location: SourceLocation) -> Witness {
    Witness {
        function,
        value: ABSENT_WORD,
        location,
    }
}

fn source(path: &[u8], text: &[u8], origin: ModuleOrigin) -> Option<ModuleSource> {
    Some(ModuleSource::new(path, text).with_origin(origin))
}

fn texts() -> SourceTexts {
    SourceTexts::new(vec![
        source(PROGRAM_PATH, PROGRAM_TEXT, ModuleOrigin::Program),
        source(DEPENDENCY_PATH, DEPENDENCY_TEXT, ModuleOrigin::Dependency),
        source(RUNTIME_PATH, b"", ModuleOrigin::Runtime),
    ])
}

fn append_name(text: &mut Vec<u8>, name: &[u8]) -> TextRange {
    let offset = text.len() as u32;
    text.extend_from_slice(name);
    let length = name.len() as u32;
    TextRange { offset, length }
}

pub(super) struct ReportFixture<'a> {
    pub records: ResultRecords<'a>,
    pub statistics: Statistics,
    pub options: AotOptions,
    pub used_features: UsedFeatures,
}

impl<'a> ReportFixture<'a> {
    pub(super) fn new(records: ResultRecords<'a>) -> ReportFixture<'a> {
        ReportFixture {
            records,
            statistics: Statistics::default(),
            options: AotOptions::default(),
            used_features: UsedFeatures {
                features: Vec::new(),
                causes: Vec::new(),
                locales: UsedLocales::Listed(Vec::new()),
                starts_workers_from_unseen_code: false,
                names_bun_build: false,
            },
        }
    }

    pub(super) fn with_input<R>(&self, then: impl FnOnce(&ReportInput<'_>) -> R) -> R {
        let texts = texts();
        let mut text = self.records.text.to_vec();
        let function_names = FUNCTIONS.map(|(function, module, name)| FunctionNameRecord {
            function,
            module,
            name: append_name(&mut text, name),
        });
        let layout_names = LAYOUTS.map(|(layout, name)| LayoutNameRecord {
            layout,
            name: append_name(&mut text, name),
        });
        let mut records = self.records;
        records.text = &text;
        if records.function_names.is_empty() {
            records.function_names = &function_names;
        }
        if records.layout_names.is_empty() {
            records.layout_names = &layout_names;
        }
        records.with_result(|engine| {
            then(&ReportInput {
                engine,
                texts: &texts,
                statistics: &self.statistics,
                options: &self.options,
                used_features: &self.used_features,
                decision: None,
            })
        })
    }
}
