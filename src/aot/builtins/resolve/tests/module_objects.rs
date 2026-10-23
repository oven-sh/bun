use super::super::{ModuleField, ModuleObjectOwner, ModuleObjectUse};
use super::*;
use ModuleObjectOwner::{EntryPoint, OwnFile, Related};
use ModuleObjectUse::{Children, Field, Object, Parent, ParentTested, Tested};

type Mention = (&'static str, ModuleObjectOwner, ModuleObjectUse);

#[track_caller]
fn assert_mentions(setup: Setup, source: &str, expected: &[Mention]) {
    with_case(setup, source, |case| {
        let mentions = case.resolved.module_object_mentions().iter();
        let found: Vec<(&str, ModuleObjectOwner, ModuleObjectUse)> = mentions
            .map(|mention| {
                let text = match mention.expr.some() {
                    Some(expr) => case.text_of(expr),
                    None => "",
                };
                (text, mention.owner, mention.object_use)
            })
            .collect();
        assert_eq!(found, expected, "{source}");
    });
}

#[test]
fn what_is_answered_without_the_object() {
    for source in [
        "module.exports = 1;",
        "module.exports.a = 1; exports.b = module.exports.a;",
        "module.paths;",
        "module.require; module.require('./a');",
        "typeof module; !module; module && 1; if (module) {} module == null; module !== undefined;",
        "module ? 1 : 2; (0, module) ? 1 : 2; void module; module;",
        "const m = module; m.exports = 1; typeof m;",
        "exports = module.exports = f;",
        "exports = module.exports = { a: 1 }; exports.b = 2;",
        "exports = module.exports = function () {}; exports.a = module.exports.b;",
    ] {
        assert_mentions(SCRIPT, source, &[]);
    }
}

#[test]
fn fields_of_the_record() {
    assert_mentions(
        SCRIPT,
        "module.id; module.filename; module.path; module.loaded;",
        &[
            ("module.id", OwnFile, Field(ModuleField::Id)),
            ("module.filename", OwnFile, Field(ModuleField::Filename)),
            ("module.path", OwnFile, Field(ModuleField::Path)),
            ("module.loaded", OwnFile, Field(ModuleField::Loaded)),
        ],
    );
    assert_mentions(
        SCRIPT,
        "const m = module; f(m.id); const r = require; r.main.filename;",
        &[
            ("m.id", OwnFile, Field(ModuleField::Id)),
            ("r.main.filename", EntryPoint, Field(ModuleField::Filename)),
        ],
    );
    with_case(SCRIPT, "require.main.id; module.id;", |case| {
        assert_unresolved(case, "require.main.id");
        assert_builtin(case, "module.id", BuiltinId::ModuleObjectId);
        let mention = case
            .resolved
            .module_object_mention(case.expr("require.main.id"));
        assert_eq!(mention.map(|it| it.owner), Some(EntryPoint));
        assert_eq!(
            case.resolved
                .module_object_mention(case.expr("require.main")),
            None
        );
    });
}

#[test]
fn a_field_that_may_hold_something_else() {
    assert_mentions(SCRIPT, "module.id = 1;", &[("module", OwnFile, Object)]);
    assert_mentions(
        SCRIPT,
        "delete module.loaded;",
        &[("module", OwnFile, Object)],
    );
    assert_mentions(SCRIPT, "module.id++;", &[("module", OwnFile, Object)]);
    assert_mentions(
        SCRIPT,
        "process.mainModule.filename;",
        &[("process.mainModule", EntryPoint, Object)],
    );
    assert_mentions(
        SCRIPT,
        "require = f; require.main.id;",
        &[("require.main", EntryPoint, Object), ("", OwnFile, Object)],
    );
    assert_mentions(
        SCRIPT,
        "module.parent.id;",
        &[("module.parent", OwnFile, Parent)],
    );
}

#[test]
fn the_object_as_a_value() {
    for source in [
        "f(module);",
        "x = { module };",
        "x === module;",
        "module.hot;",
        "module.notThere = 1;",
        "module[key];",
        "module._compile(text, name);",
        "const { id } = module;",
        "Object.defineProperty(module, 'exports', {});",
        "'id' in module;",
        "let held; held = module;",
        "module.require = f;",
        "delete module.exports;",
    ] {
        assert_mentions(SCRIPT, source, &[("module", OwnFile, Object)]);
    }
    assert_mentions(SCRIPT, "const m = module; f(m);", &[("m", OwnFile, Object)]);
    assert_mentions(
        SCRIPT,
        "f(require.main);",
        &[("require.main", EntryPoint, Object)],
    );
    assert_mentions(
        SCRIPT,
        "const m = require.main; m.exports;",
        &[("m", EntryPoint, Object)],
    );
    assert_mentions(
        SCRIPT,
        "process.mainModule = 1;",
        &[("process.mainModule", EntryPoint, Object)],
    );
}

#[test]
fn where_no_expression_names_the_object() {
    for source in [
        "eval(text);",
        "arguments;",
        "var module;",
        "exports = 1;",
        "exports = module.exports;",
        "exports = other.exports = f;",
        "x = exports = module.exports = f;",
        "if (x) exports = module.exports = f;",
        "function g() { exports = module.exports = f; }",
        "exports = module.exports = f; exports = 1;",
        "exports += module.exports = f;",
        "module.exports = exports = f;",
        "__filename = 1;",
    ] {
        assert_mentions(SCRIPT, source, &[("", OwnFile, Object)]);
    }
    assert_mentions(SCRIPT, "with (o) module;", &[("", OwnFile, Object)]);
}

#[test]
fn the_store_that_goes_along_with_module_exports() {
    with_case(
        SCRIPT,
        "exports = module.exports = f; function g() { exports = 1; }",
        |case| {
            let stores = case.exprs("exports");
            let with_module_exports =
                |&name: &ExprId| case.resolved.is_stored_with_module_exports(name);
            assert_eq!(
                stores
                    .iter()
                    .filter(|&name| with_module_exports(name))
                    .count(),
                1
            );
            assert!(with_module_exports(&stores[0]));
        },
    );
}

#[test]
fn tests_of_other_objects() {
    assert_mentions(
        SCRIPT,
        "if (!module.parent) {} module.parent == null; typeof module.parent; module.parent && 1;",
        &[
            ("module.parent", OwnFile, ParentTested),
            ("module.parent", OwnFile, ParentTested),
            ("module.parent", OwnFile, ParentTested),
            ("module.parent", OwnFile, ParentTested),
        ],
    );
    assert_mentions(
        SCRIPT,
        "!require.main; process.mainModule ? 1 : 2;",
        &[
            ("require.main", EntryPoint, Tested),
            ("process.mainModule", EntryPoint, Tested),
        ],
    );
    assert_mentions(
        SCRIPT,
        "f(module.parent || 1); module.parent === x;",
        &[
            ("module.parent", OwnFile, Parent),
            ("module.parent", OwnFile, Parent),
        ],
    );
}

#[test]
fn along_children_and_parent() {
    assert_mentions(
        SCRIPT,
        "const c = module.children; c.length; c[0].exports.x; c[0].parent === module;",
        &[
            ("module.children", OwnFile, Children),
            ("c[0].parent", Related, Parent),
            ("module", OwnFile, Object),
        ],
    );
    assert_mentions(
        SCRIPT,
        "require.main.children[i].children; f(module.parent.parent);",
        &[
            ("require.main.children", EntryPoint, Children),
            ("require.main.children[i].children", Related, Children),
            ("module.parent", OwnFile, Parent),
            ("module.parent.parent", Related, Parent),
        ],
    );
    assert_mentions(
        SCRIPT,
        "let kid = module.children[0]; kid.children;",
        &[
            ("module.children", OwnFile, Children),
            ("kid.children", Related, Children),
        ],
    );
    with_case(SCRIPT, "module.children[0].exports;", |case| {
        assert_unresolved(case, "module.children[0]");
        assert_unresolved(case, "module.children[0].exports");
        assert!(case.mentions(BuiltinId::ModuleObjectChildren));
    });
}

#[test]
fn members_that_a_pattern_reads() {
    let object = ("module", OwnFile, Object);
    assert_mentions(
        SCRIPT,
        "const { parent } = module;",
        &[object, ("module", OwnFile, Parent)],
    );
    assert_mentions(
        SCRIPT,
        "const { id, children: kids } = module;",
        &[object, ("module", OwnFile, Children)],
    );
    for source in [
        "const { id, ...others } = module;",
        "const { [key]: found } = module;",
    ] {
        assert_mentions(
            SCRIPT,
            source,
            &[
                object,
                ("module", OwnFile, Parent),
                ("module", OwnFile, Children),
            ],
        );
    }
    assert_mentions(
        SCRIPT,
        "const { parent: { children } } = module;",
        &[
            object,
            ("module", OwnFile, Parent),
            ("module", Related, Children),
        ],
    );
    assert_mentions(
        SCRIPT,
        "const { children } = require.main;",
        &[
            ("require.main", EntryPoint, Object),
            ("require.main", EntryPoint, Children),
        ],
    );
    assert_mentions(
        SCRIPT,
        "const { children } = module.parent;",
        &[
            ("module.parent", OwnFile, Parent),
            ("module.parent", Related, Children),
        ],
    );
    assert_mentions(
        SCRIPT,
        "const { parent } = module; parent.children;",
        &[
            object,
            ("module", OwnFile, Parent),
            ("parent.children", Related, Children),
        ],
    );
}

#[test]
fn a_require_that_the_program_has_made() {
    let import = "import { createRequire } from \"node:module\";";
    let source = format!("{import} const made = createRequire(\"/a\"); made.main; made.cache;");
    with_case(PROGRAM, &source, |case| {
        assert_unresolved(case, "made");
        assert_unresolved(case, "made.main");
        assert!(case.mentions(BuiltinId::ModuleRequireMain));
        assert!(case.mentions(BuiltinId::ModuleRequireCache));
    });
    let source = format!("{import} f(createRequire(import.meta.url).main.children);");
    assert_mentions(
        PROGRAM,
        &source,
        &[(
            "createRequire(import.meta.url).main.children",
            EntryPoint,
            Children,
        )],
    );
    let source = format!("{import} let made = createRequire(\"/a\"); made = f; made.main;");
    assert_mentions(PROGRAM, &source, &[]);
}

#[test]
fn an_es_module_has_no_module_object() {
    assert_mentions(PROGRAM, "f(module); module.id; export {};", &[]);
    assert_mentions(
        PROGRAM,
        "require.main.id; export {};",
        &[("require.main", EntryPoint, Object)],
    );
}
