use bun_options_types::aot_options::AotOptions;
use bun_trim::{UsedFeatures, UsedLocales};

use super::{ModuleSource, ReportInput, SourceTexts};
use crate::engine::testing::ResultRecords;
use crate::engine::{Position, SourceLocation};
use crate::ir::generated::Witness;
use crate::ir::ids::{ABSENT_WORD, ModuleId};
use crate::link::{ModuleOrigin, ProgramNames};
use crate::statistics::Statistics;

pub(super) const PROGRAM: u32 = 0;
pub(super) const DEPENDENCY: u32 = 1;
pub(super) const RUNTIME: u32 = 2;
pub(super) const PROGRAM_FUNCTION: u32 = 0;
pub(super) const RUNTIME_FUNCTION: u32 = 1;
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

pub(super) fn names() -> ProgramNames {
    ProgramNames::from_lists(
        &[
            (&b"double"[..], Some(ModuleId::from_word(PROGRAM))),
            (&b"readFile"[..], Some(ModuleId::from_word(RUNTIME))),
        ],
        &[&b"Item"[..], b"Order"],
        &[
            (PROGRAM_PATH, ModuleOrigin::Program),
            (DEPENDENCY_PATH, ModuleOrigin::Dependency),
            (RUNTIME_PATH, ModuleOrigin::Runtime),
        ],
    )
}

fn texts() -> SourceTexts {
    let source = |path: &[u8], text: &[u8]| Some(ModuleSource::new(path, text));
    SourceTexts::new(vec![
        source(PROGRAM_PATH, PROGRAM_TEXT),
        source(DEPENDENCY_PATH, DEPENDENCY_TEXT),
        None,
    ])
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
            },
        }
    }

    pub(super) fn with_input<R>(&self, then: impl FnOnce(&ReportInput<'_>) -> R) -> R {
        let (names, texts) = (names(), texts());
        self.records.with_result(|engine| {
            then(&ReportInput {
                engine,
                names: &names,
                texts: &texts,
                statistics: &self.statistics,
                options: &self.options,
                used_features: &self.used_features,
                decision: None,
            })
        })
    }
}
