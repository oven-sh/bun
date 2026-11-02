use bun_ast::Log;
use bun_sema::atom::Interner;
use bun_sema::fold::{Define, DefinePath, DefineRoot, DefineValue, FoldOptions};
use bun_sema::hir_from_data::DataModule;
use bun_sema::program::FileId;
use bun_sema::session::Arena;

use crate::compile::testing::{
    default_settings, lower_program_with_limits, lower_program_with_provider,
};
use crate::ir::generated::{FieldForm, LayoutKind, visit_value_fields};
use crate::ir::{FieldWord, Id, LayoutKey, Opcode, Reference, ValueView};
use crate::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, ModuleName, Resolution, ResolveRequest, SourceFile,
    SourceProvider, WithoutServices,
};
use crate::lower::{Fragment, LoweredFile};
use crate::statistics::{LimitId, LimitValues};

const PLAIN: FieldForm = FieldForm(0);
const FIXED: FieldForm = FieldForm(
    FieldForm::IS_READ_ONLY.0 | FieldForm::IS_NOT_ENUMERABLE.0 | FieldForm::IS_NOT_CONFIGURABLE.0,
);

#[track_caller]
fn lower_module(source: &str) -> Fragment {
    let files = [("main.cjs", source)];
    let mut lowered = lower_program_with_limits(&files, LimitValues::for_host());
    assert_eq!(lowered.len(), 1);
    lowered.remove(0).1.fragment
}

fn describe_exports(fragment: &Fragment) -> Vec<(String, FieldForm)> {
    let mut layouts = fragment.layouts.iter().filter(|(id, layout)| {
        let is_container = matches!(fragment.layout_keys[id.index()], LayoutKey::Container(_));
        is_container && layout.kind == LayoutKind::Record
    });
    let Some((_, layout)) = layouts.next() else {
        return Vec::new();
    };
    assert!(layouts.next().is_none(), "a module has one exports object");
    let fields = layout.fields.iter().map(|field| {
        let key = field.key.expect("a field of an exports object has a name");
        let text = fragment
            .property_keys
            .get(key)
            .text
            .expect("the name is a text");
        let name = String::from_utf8_lossy(fragment.strings.get(text)).into_owned();
        (name, field.form)
    });
    fields.collect()
}

#[track_caller]
fn names_of(source: &str) -> Vec<String> {
    let fragment = lower_module(source);
    describe_exports(&fragment)
        .into_iter()
        .map(|it| it.0)
        .collect()
}

fn find_fragment(lowered: &[(FileId, LoweredFile)], defines_exports_layout: bool) -> &Fragment {
    let mut fragments = lowered.iter().map(|(_, file)| &file.fragment);
    let fragment =
        fragments.find(|fragment| describe_exports(fragment).is_empty() != defines_exports_layout);
    fragment.expect("one of the two files defines the layout of its exports object")
}

#[test]
fn names_are_in_the_order_in_which_the_body_creates_them() {
    let names = names_of(
        "\"use strict\";
Object.defineProperty(exports, \"__esModule\", { value: true });
exports.C = exports.B = exports.A = void 0;
exports.f = f;
exports.B = 2;
exports.z = (exports.y = 1) + (exports.x = 2);
function f() {}
",
    );
    assert_eq!(names, ["__esModule", "A", "B", "C", "f", "y", "x", "z"]);
}

#[test]
fn stores_of_functions_come_after_those_of_the_body() {
    let names = names_of(
        "function late() { exports.late = 1; }
const later = () => { exports.later = 2; };
(function () { exports.first = 3; })();
(() => { exports.second = 4; })();
(async function () { exports.afterAwait = 5; })();
exports.third = [late, later];
",
    );
    assert_eq!(
        names,
        ["first", "second", "third", "late", "later", "afterAwait"]
    );
}

#[test]
fn a_field_has_the_form_of_the_first_definition() {
    let fragment = lower_module(
        "Object.defineProperty(exports, \"marker\", { value: true });
Object.defineProperty(exports, \"getter\", { enumerable: true, get: function () { return 1; } });
Object.defineProperty(exports, \"method\", { configurable: true, get() { return 1; } });
Object.defineProperty(exports, \"open\", { value: 1, writable: true, enumerable: true, configurable: true });
Reflect.defineProperty(exports, \"shown\", { value: 1, enumerable: true, writable: false });
exports.plain = 1;
Object.defineProperty(exports, \"plain\", { enumerable: false });
",
    );
    let expected = [
        ("marker", FIXED),
        (
            "getter",
            FieldForm::IS_ACCESSOR | FieldForm::IS_NOT_CONFIGURABLE,
        ),
        (
            "method",
            FieldForm::IS_ACCESSOR | FieldForm::IS_NOT_ENUMERABLE,
        ),
        ("open", PLAIN),
        (
            "shown",
            FieldForm::IS_READ_ONLY | FieldForm::IS_NOT_CONFIGURABLE,
        ),
        ("plain", PLAIN),
    ];
    let expected = expected.map(|(name, form)| (name.to_owned(), form));
    assert_eq!(describe_exports(&fragment), expected);
}

#[test]
fn a_property_of_unknown_form_is_no_field() {
    let names = names_of(
        "const descriptor = { value: 1 };
Object.defineProperty(exports, \"byVariable\", descriptor);
Object.defineProperty(exports, \"bySpread\", { ...descriptor });
Object.defineProperty(exports, \"byFlag\", { value: 1, enumerable: Math.random() > 2 });
Object.defineProperty(exports, \"both\", { value: 1, get() {} });
Object.defineProperty(exports, \"fixedGetter\", { get() {}, writable: false });
exports.byVariable = 2;
exports.known = 3;
",
    );
    assert_eq!(names, ["known"]);
}

#[test]
fn names_that_no_slot_holds_are_no_fields() {
    let names = names_of(
        "exports[0] = 1;
exports[\"1.5\"] = 2;
exports.__proto__ = {};
exports[Symbol.iterator] = 3;
exports[name()] = 4;
exports[\"with space\"] = 5;
exports.constructor = 6;
function name() { return \"computed\"; }
",
    );
    assert_eq!(names, ["with space", "constructor"]);
}

#[test]
fn every_way_to_name_the_object_counts() {
    let names = names_of(
        "module.exports.one = 1;
this.two = 2;
module[\"exports\"][\"three\"] = 3;
const store = () => { this.four = 4; };
exports.five += 5;
[exports.six] = [6];
",
    );
    assert_eq!(names, ["one", "two", "three", "five", "six", "four"]);
}

#[test]
fn what_is_only_called_exports_does_not_count() {
    let names = names_of(
        "(function (exports) { exports.ofParameter = 1; })({});
(function (module) { module.exports.ofOtherModule = 2; module.exports = 3; })({ exports: {} });
{ let exports = {}; exports.ofBlock = 4; }
function method() { this.ofCaller = 5; }
class Holder { field = (this.ofInstance = 6); static { this.ofClass = 7; } }
exports.own = [method, Holder];
",
    );
    assert_eq!(names, ["own"]);
}

#[test]
fn a_module_that_replaces_its_exports_creates_none() {
    for source in [
        "exports.a = 1; module.exports = { b: 2 };",
        "module.exports = function () {}; module.exports.a = 1;",
        "exports = module.exports = {}; exports.a = 1;",
        "exports.a = 1; function reset() { module.exports = null; }",
        "exports.a = 1; module.exports ||= {};",
        "exports = {}; exports.a = 1;",
        "exports.a = 1; module = { exports: {} };",
    ] {
        assert_eq!(names_of(source), [""; 0], "{source}");
    }
}

#[test]
fn storing_the_same_object_replaces_nothing() {
    assert_eq!(names_of("module.exports = exports; exports.a = 1;"), ["a"]);
    assert_eq!(names_of("module.exports = this; exports.a = 1;"), ["a"]);
}

#[test]
fn a_module_that_stores_no_name_creates_none() {
    assert_eq!(names_of("const unused = exports;"), [""; 0]);
    assert_eq!(names_of("if (false) exports.dead = 1;"), [""; 0]);
}

#[test]
fn names_over_the_limit_are_no_fields() {
    let mut limits = LimitValues::for_host();
    limits.lower(LimitId::FieldsInKeyOrder, 2);
    let files = [("main.cjs", "exports.a = 1; exports.b = 2; exports.c = 3;")];
    let lowered = lower_program_with_limits(&files, limits);
    let names: Vec<String> = describe_exports(&lowered[0].1.fragment)
        .into_iter()
        .map(|it| it.0)
        .collect();
    assert_eq!(names, ["a", "b"]);
}

#[test]
fn whoever_requires_a_module_names_its_layout() {
    let files = [
        // Somebody looks at the object, so the module has one.
        (
            "main.cjs",
            "module.exports = Object.keys(require(\"./names.cjs\"));",
        ),
        ("names.cjs", "exports.a = 1;"),
    ];
    let lowered = lower_program_with_limits(&files, LimitValues::for_host());
    assert_eq!(lowered.len(), 2);
    let module = find_fragment(&lowered, true);
    let requirer = find_fragment(&lowered, false);
    let names_layout_of_module = |key: &LayoutKey| match *key {
        LayoutKey::Container(symbol) => symbol.file == module.file,
        _ => false,
    };
    assert!(requirer.layout_keys.iter().any(names_layout_of_module));
    let mut defined_keys = requirer
        .layouts
        .iter()
        .map(|(id, _)| &requirer.layout_keys[id.index()]);
    assert!(
        !defined_keys.any(names_layout_of_module),
        "only its own file defines the layout"
    );
}

/// `--define EXP=exports`
struct ExportsByDefine;

impl SourceProvider for ExportsByDefine {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        let define = Define {
            path: DefinePath {
                root: DefineRoot::Global(atoms.intern(b"EXP")),
                members: &[],
            },
            value: DefineValue::GlobalPath(arena.alloc_slice_copy(&[atoms.intern(b"exports")])),
        };
        FoldOptions {
            defines: arena.alloc_slice_copy(&[define]),
            ..WithoutServices.fold_options(arena, atoms, log)
        }
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        WithoutServices.resolve(request, log)
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        WithoutServices.load(request, log)
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        WithoutServices.has_load_plugin(module)
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, Failed> {
        WithoutServices.parse_data(file, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

// The variable of the module that the operation reads or stores.
fn variable_of(value: ValueView<'_>) -> Option<Reference> {
    let fields = value.fields;
    let mut variable = None;
    visit_value_fields(value.opcode, fields, 0, &mut |field, at| match field {
        FieldWord::Operand => {}
        FieldWord::Reference(kind) => variable = Reference::from_word(kind, fields[at]),
    });
    variable
}

#[test]
fn a_body_that_names_its_first_object_through_a_define_makes_the_object() {
    let source = "module.exports = { b: 2 };
EXP.c = 3;
console.log(Object.keys(module.exports).join(), Object.keys(EXP).join());
";
    let files = [("main.cjs", source)];
    let lowered = lower_program_with_provider(&files, &default_settings(), &ExportsByDefine);
    assert_eq!(lowered.len(), 1);
    let fragment = &lowered[0].1.fragment;
    let body = fragment.module.body.expect("the module has a body");
    let mut functions = fragment.functions.iter();
    let (_, function) = functions
        .find(|(function, _)| *function == body)
        .expect("the fragment defines the body of its module");
    let values = function.body.blocks().flat_map(|block| block.values());
    let values: Vec<ValueView<'_>> = values.collect();
    let is_read = |value: &ValueView<'_>| value.opcode == Opcode::GetModuleVariable;
    let read = values.iter().position(is_read);
    let read = read.expect("the body reads the object through the define");
    let first_object = variable_of(values[read]);
    let in_front = &values[..read];
    let is_made = |value: &ValueView<'_>| value.opcode == Opcode::NewObject;
    let is_stored = |value: &ValueView<'_>| {
        value.opcode == Opcode::PutModuleVariable && variable_of(*value) == first_object
    };
    let made = in_front.iter().position(is_made);
    let made = made.expect("the body makes the object that it begins with");
    let stored = in_front.iter().position(is_stored);
    let stored = stored.expect("the body stores the object where the define reads it");
    assert!(made < stored);
}
