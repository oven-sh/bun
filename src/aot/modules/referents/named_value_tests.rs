use super::tests::{BoundProgram, with_program};
use super::*;
use crate::modules::testing::{file_named, with_runtime_graph};
use bun_sema::check::aot::PrototypeOperation;
use bun_sema::hir::{CallId, StmtKind};

const INHERITS: Option<NamedValue> = named(PrototypeOperation::LinkClasses {
    child: 0,
    parent: 1,
});

const fn named(operation: PrototypeOperation) -> Option<NamedValue> {
    Some(NamedValue::PrototypeOperation(operation))
}

fn declaring_file(value: Option<NamedValue>) -> Option<FileId> {
    match value? {
        NamedValue::Class(class) => Some(class.file),
        NamedValue::Function(function) => Some(function.file),
        NamedValue::PrototypeOperation(_) => None,
    }
}

fn with_runtime_program(files: &[(&str, &str)], check: impl FnOnce(&BoundProgram<'_, '_, '_>)) {
    with_runtime_graph(files, |graph, input| check(&BoundProgram { graph, input }));
}

impl BoundProgram<'_, '_, '_> {
    fn named_value(&self, file: FileId, expression: ExprId) -> Option<NamedValue> {
        self.project().find_named_value(file, expression)
    }

    fn statement_calls(&self, file: FileId) -> Vec<CallId> {
        let hir = self.input.files.hir(file);
        let statements = hir.ids(hir.body);
        statements
            .filter_map(|statement| match hir[statement].kind {
                StmtKind::Expr(expression) => Some(expression),
                _ => None,
            })
            .filter_map(|expression| match hir[expression].kind {
                ExprKind::Call(site) => Some(site),
                _ => None,
            })
            .collect()
    }

    fn callees_of_statements(&self, name: &str) -> Vec<Option<NamedValue>> {
        let file = file_named(self.input, name);
        let hir = self.input.files.hir(file);
        let calls = self.statement_calls(file).into_iter();
        calls
            .map(|site| self.named_value(file, hir[site].callee))
            .collect()
    }

    fn files_declaring_last_arguments(&self, name: &str) -> Vec<Option<FileId>> {
        let file = file_named(self.input, name);
        let hir = self.input.files.hir(file);
        let calls = self.statement_calls(file);
        let last = *calls.last().expect("no statement of the file is a call");
        let arguments = hir.ids(hir[last].args);
        arguments
            .map(|argument| declaring_file(self.named_value(file, argument)))
            .collect()
    }
}

#[test]
fn members_of_global_objects_are_operations() {
    let main = "
        Object.setPrototypeOf(a, b);
        Reflect.setPrototypeOf(a, b);
        Object.create(a);
        Object.assign(a, b);
        parseFloat.call(a, b);
        Object.keys(a);
    ";
    with_program(&[("main.cjs", main)], |program| {
        let set_prototype = named(PrototypeOperation::SetPrototype {
            object: 0,
            parent: 1,
        });
        assert_eq!(
            program.callees_of_statements("main.cjs"),
            [
                set_prototype,
                set_prototype,
                named(PrototypeOperation::CreateObject { parent: 0 }),
                named(PrototypeOperation::CopyProperties { target: 0 }),
                named(PrototypeOperation::CallFunction { receiver: 0 }),
                None,
            ]
        );
    });
}

#[test]
fn member_of_another_object_is_no_operation() {
    let main = "
        const Object = { create(parent) {} };
        Object.create(a);
    ";
    with_program(&[("main.cjs", main)], |program| {
        let callees = program.callees_of_statements("main.cjs");
        assert!(matches!(
            callees[..],
            [None | Some(NamedValue::Function(_))]
        ));
    });
}

#[test]
fn member_of_required_runtime_module_is_builtin() {
    let main = "
        const util = require('node:util');
        const { inherits } = require('node:util');
        util.inherits(A, B);
        inherits(A, B);
        require('node:util').inherits(A, B);
        process.getBuiltinModule('node:util').inherits(A, B);
        util.format(A);
        util.missing(A);
    ";
    with_program(&[("main.cjs", main)], |program| {
        assert_eq!(
            program.callees_of_statements("main.cjs"),
            [INHERITS, INHERITS, INHERITS, INHERITS, None, None]
        );
    });
}

#[test]
fn export_of_imported_runtime_module_is_builtin() {
    let main = "
        import { inherits } from 'node:util';
        import * as util from 'node:util';
        inherits(A, B);
        util.inherits(A, B);
        util.format(A);
    ";
    with_program(&[("main.js", main)], |program| {
        assert_eq!(
            program.callees_of_statements("main.js"),
            [INHERITS, INHERITS, None]
        );
    });
}

#[test]
fn functions_of_required_files_are_found() {
    let main = "
        const Whole = require('./whole.cjs');
        const { Member } = require('./members.cjs');
        const members = require('./members.cjs');
        const namespace = require('./module.mjs');
        use(Whole, Member, members.Member, namespace.Exported, members.Missing);
    ";
    let files = [
        ("main.cjs", main),
        ("whole.cjs", "module.exports = function () {};\n"),
        ("members.cjs", "exports.Member = function () {};\n"),
        ("module.mjs", "export function Exported() {}\n"),
    ];
    with_program(&files, |program| {
        let file = |name| Some(file_named(program.input, name));
        assert_eq!(
            program.files_declaring_last_arguments("main.cjs"),
            [
                file("whole.cjs"),
                file("members.cjs"),
                file("members.cjs"),
                file("module.mjs"),
                None,
            ]
        );
    });
}

#[test]
fn call_that_loads_no_module_names_nothing() {
    let main = "
        const made = make('./whole.cjs');
        const resolved = require.resolve('./whole.cjs');
        use(made, made.Member, resolved);
    ";
    let files = [
        ("main.cjs", main),
        ("whole.cjs", "module.exports = function () {};\n"),
    ];
    with_program(&files, |program| {
        assert_eq!(
            program.files_declaring_last_arguments("main.cjs"),
            [None, None, None]
        );
    });
}

#[test]
fn spellings_of_runtime_modules_are_operations() {
    let path = "
        const Base = require('node:os');
        function Child() {}
        Base.$call(undefined);
        Base.$apply(undefined, []);
        $call(Base, undefined);
        $toClass(Child, 'Child', Base);
        export default Child;
    ";
    let files = [
        ("main.js", "import 'node:path';\n"),
        ("/$bun/js/node/path.ts", path),
        (
            "/$bun/js/node/os.ts",
            "function Base() {}\nexport default Base;\n",
        ),
    ];
    with_runtime_program(&files, |program| {
        let call_function = named(PrototypeOperation::CallFunction { receiver: 0 });
        let to_class = named(PrototypeOperation::LinkClasses {
            child: 0,
            parent: 2,
        });
        assert_eq!(
            program.callees_of_statements("/$bun/js/node/path.ts"),
            [call_function, call_function, None, to_class]
        );
        let file = |name| Some(file_named(program.input, name));
        assert_eq!(
            program.files_declaring_last_arguments("/$bun/js/node/path.ts"),
            [
                file("/$bun/js/node/path.ts"),
                None,
                file("/$bun/js/node/os.ts")
            ]
        );
    });
}

#[test]
fn node_without_import_site_has_no_answer() {
    with_program(&[("main.cjs", "run();\n")], |program| {
        let main = file_named(program.input, "main.cjs");
        let site = ImportSiteKind::Require(ExprId(0));
        assert_eq!(program.graph.find_site_answer(main, site), None);
    });
}
