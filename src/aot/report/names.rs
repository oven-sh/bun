use super::ReportInput;
use super::source_texts::{ModuleOrigin, SourceTexts};
use crate::engine::{EngineResult, FunctionNameRecord};
use crate::ir::ids::{FunctionId, LayoutId, ModuleId};

#[derive(Copy, Clone)]
pub(super) struct Names<'a> {
    engine: &'a EngineResult,
    texts: &'a SourceTexts,
}

impl<'a> Names<'a> {
    pub(super) fn new(input: &ReportInput<'a>) -> Names<'a> {
        let engine = input.engine;
        let (functions, layouts) = (engine.function_names(), engine.layout_names());
        debug_assert!(functions.is_sorted_by(|left, right| left.function < right.function));
        debug_assert!(layouts.is_sorted_by(|left, right| left.layout < right.layout));
        Names {
            engine,
            texts: input.texts,
        }
    }

    pub(super) fn function_name(&self, function: FunctionId) -> &'a [u8] {
        match self.function_record(function) {
            Some(record) => self.engine.text(record.name),
            None => &[],
        }
    }

    pub(super) fn function_module(&self, function: FunctionId) -> Option<ModuleId> {
        self.function_record(function)?.module_id()
    }

    pub(super) fn layout_name(&self, layout: LayoutId) -> &'a [u8] {
        let records = self.engine.layout_names();
        match records.binary_search_by_key(&layout.to_word(), |record| record.layout) {
            Ok(index) => self.engine.text(records[index].name),
            Err(_) => &[],
        }
    }

    pub(super) fn module_path(&self, module: ModuleId) -> &'a [u8] {
        self.texts.path(module)
    }

    pub(super) fn module_origin(&self, module: ModuleId) -> ModuleOrigin {
        self.texts.origin(module)
    }

    fn function_record(&self, function: FunctionId) -> Option<&'a FunctionNameRecord> {
        let records = self.engine.function_names();
        let index = records.binary_search_by_key(&function.to_word(), |record| record.function);
        Some(&records[index.ok()?])
    }
}

#[cfg(test)]
mod tests {
    use bstr::BString;

    use super::*;
    use crate::engine::testing::ResultRecords;
    use crate::engine::{LayoutNameRecord, TextRange};
    use crate::ir::ids::ABSENT_WORD;
    use crate::report::ModuleSource;
    use crate::report::testing::{PROGRAM, RUNTIME, ReportFixture};

    const OWN_MODULE: u32 = 0;
    const PACKAGE_MODULE: u32 = 1;
    const MODULE_WITHOUT_SOURCE: u32 = 2;
    const MODULE_PAST_THE_END: u32 = 9;

    const TEXT: &[u8] = b"double readFile Item Order";
    const DOUBLE: TextRange = range(0, 6);
    const READ_FILE: TextRange = range(7, 8);
    const ITEM: TextRange = range(16, 4);
    const ORDER: TextRange = range(21, 5);
    const NO_NAME: TextRange = range(0, 0);

    const FUNCTIONS: &[FunctionNameRecord] = &[
        listed_function(2, OWN_MODULE, DOUBLE),
        listed_function(5, MODULE_WITHOUT_SOURCE, READ_FILE),
        listed_function(6, PACKAGE_MODULE, NO_NAME),
        listed_function(40, ABSENT_WORD, DOUBLE),
    ];
    const LAYOUTS: &[LayoutNameRecord] = &[
        listed_layout(1, ITEM),
        listed_layout(7, NO_NAME),
        listed_layout(8, ORDER),
    ];

    const fn range(offset: u32, length: u32) -> TextRange {
        TextRange { offset, length }
    }

    const fn listed_function(function: u32, module: u32, name: TextRange) -> FunctionNameRecord {
        FunctionNameRecord {
            function,
            module,
            name,
        }
    }

    const fn listed_layout(layout: u32, name: TextRange) -> LayoutNameRecord {
        LayoutNameRecord { layout, name }
    }

    fn listed() -> ResultRecords<'static> {
        ResultRecords {
            text: TEXT,
            function_names: FUNCTIONS,
            layout_names: LAYOUTS,
            ..ResultRecords::default()
        }
    }

    fn texts() -> SourceTexts {
        let package = ModuleSource::new(b"node_modules/b/b.js", b"b();");
        SourceTexts::new(vec![
            Some(ModuleSource::new(b"src/a.ts", b"a();")),
            Some(package.with_origin(ModuleOrigin::Dependency)),
            None,
        ])
    }

    fn with_names<R>(records: &ResultRecords<'_>, then: impl FnOnce(Names<'_>) -> R) -> R {
        let texts = texts();
        records.with_result(|engine| {
            then(Names {
                engine,
                texts: &texts,
            })
        })
    }

    fn name_and_module(records: &ResultRecords<'_>, function: u32) -> (BString, Option<u32>) {
        let function = FunctionId::from_word(function);
        with_names(records, |names| {
            let module = names.function_module(function);
            let name = BString::from(names.function_name(function));
            (name, module.map(ModuleId::to_word))
        })
    }

    fn name_of_layout(records: &ResultRecords<'_>, layout: u32) -> BString {
        let layout = LayoutId::from_word(layout);
        with_names(records, |names| BString::from(names.layout_name(layout)))
    }

    #[test]
    fn listed_function_has_its_name_and_module() {
        let functions = [
            (2, "double", Some(OWN_MODULE)),
            (5, "readFile", Some(MODULE_WITHOUT_SOURCE)),
            (40, "double", None),
        ];
        for (function, name, module) in functions {
            let expected = (BString::from(name), module);
            assert_eq!(name_and_module(&listed(), function), expected);
        }
    }

    #[test]
    fn unnamed_function_has_its_module_and_an_empty_name() {
        let expected = (BString::from(""), Some(PACKAGE_MODULE));
        assert_eq!(name_and_module(&listed(), 6), expected);
    }

    #[test]
    fn function_that_is_not_listed_has_no_name_and_no_module() {
        let unknown = (BString::from(""), None);
        for function in [0, 1, 3, 7, 8, 39, 41, ABSENT_WORD - 1] {
            assert_eq!(name_and_module(&listed(), function), unknown);
        }
    }

    #[test]
    fn listed_layout_has_its_name() {
        assert_eq!(name_of_layout(&listed(), 1), "Item");
        assert_eq!(name_of_layout(&listed(), 7), "");
        assert_eq!(name_of_layout(&listed(), 8), "Order");
    }

    #[test]
    fn layout_that_is_not_listed_has_no_name() {
        for layout in [0, 2, 5, 6, 9, 40, ABSENT_WORD - 1] {
            assert_eq!(name_of_layout(&listed(), layout), "");
        }
    }

    #[test]
    fn empty_sections_name_nothing() {
        let records = ResultRecords {
            text: TEXT,
            ..ResultRecords::default()
        };
        let unknown = (BString::from(""), None);
        for id in [0, 2, ABSENT_WORD - 1] {
            assert_eq!(name_and_module(&records, id), unknown);
            assert_eq!(name_of_layout(&records, id), "");
        }
    }

    #[test]
    fn module_has_the_path_and_origin_of_its_source() {
        let answers = with_names(&listed(), |names| {
            [OWN_MODULE, PACKAGE_MODULE].map(|module| {
                let module = ModuleId::from_word(module);
                let path = BString::from(names.module_path(module));
                (path, names.module_origin(module))
            })
        });
        let expected = [
            (BString::from("src/a.ts"), ModuleOrigin::Program),
            (
                BString::from("node_modules/b/b.js"),
                ModuleOrigin::Dependency,
            ),
        ];
        assert_eq!(answers, expected);
    }

    #[test]
    fn module_without_source_has_runtime_origin_and_no_path() {
        with_names(&listed(), |names| {
            for module in [MODULE_WITHOUT_SOURCE, MODULE_PAST_THE_END] {
                let module = ModuleId::from_word(module);
                assert!(names.module_path(module).is_empty());
                assert_eq!(names.module_origin(module), ModuleOrigin::Runtime);
            }
        });
    }

    #[test]
    fn names_and_their_answers_outlive_the_borrow_of_the_input() {
        ReportFixture::new(ResultRecords::default()).with_input(|input| {
            let names = {
                let input = *input;
                Names::new(&input)
            };
            let double = FunctionId::from_word(0);
            let name = {
                let copy = names;
                copy.function_name(double)
            };
            assert_eq!(BString::from(name), "double");
            let program = ModuleId::from_word(PROGRAM);
            assert_eq!(names.function_module(double), Some(program));
            let order = LayoutId::from_word(1);
            assert_eq!(BString::from(names.layout_name(order)), "Order");
            let runtime = ModuleId::from_word(RUNTIME);
            assert_eq!(BString::from(names.module_path(runtime)), "node:fs");
            assert_eq!(names.module_origin(runtime), ModuleOrigin::Runtime);
        });
    }
}
