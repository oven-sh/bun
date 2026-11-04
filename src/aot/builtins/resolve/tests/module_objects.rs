use super::super::{ModuleField, ModuleObjectOwner, ModuleObjectUse};
use super::*;
use ModuleObjectOwner::{EntryPoint, OwnFile, Related};
use ModuleObjectUse::{
    Children, Field, HandedOn, HolderHandedOn, Object, Parent, ParentTested, Tested,
};

type Mention = (&'static str, ModuleObjectOwner, ModuleObjectUse);

#[track_caller]
fn assert_mentions_in(setup: Setup, source: &str, expected: &[Mention]) {
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

#[track_caller]
fn assert_mentions(source: &str, expected: &[Mention]) {
    assert_mentions_in(SCRIPT, source, expected);
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
        assert_mentions(source, &[]);
    }
}

#[test]
fn fields_of_the_record() {
    assert_mentions(
        "module.id; module.filename; module.path; module.loaded;",
        &[
            ("module.id", OwnFile, Field(ModuleField::Id)),
            ("module.filename", OwnFile, Field(ModuleField::Filename)),
            ("module.path", OwnFile, Field(ModuleField::Path)),
            ("module.loaded", OwnFile, Field(ModuleField::Loaded)),
        ],
    );
    assert_mentions(
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
    assert_mentions("module.id = 1;", &[("module", OwnFile, Object)]);
    assert_mentions("delete module.loaded;", &[("module", OwnFile, Object)]);
    assert_mentions("module.id++;", &[("module", OwnFile, Object)]);
    assert_mentions(
        "process.mainModule.filename;",
        &[("process.mainModule", EntryPoint, Object)],
    );
    assert_mentions(
        "require = f; require.main.id;",
        &[("require.main", EntryPoint, Object), ("", OwnFile, Object)],
    );
    assert_mentions("module.parent.id;", &[("module.parent", OwnFile, Parent)]);
}

#[test]
fn a_store_through_type_syntax_or_a_rest_is_a_store() {
    let object = [("module", OwnFile, Object)];
    for target in [
        "(module.id as any)",
        "module.id!",
        "(<any>module.id)",
        "(module.id satisfies any)",
        "((module.id as any)! as unknown)",
    ] {
        for statement in [
            format!("{target} = 1;"),
            format!("{target} += 1;"),
            format!("{target}++;"),
            format!("[{target}] = x;"),
            format!("[...{target}] = x;"),
            format!("({{ ...{target} }} = x);"),
            format!("({{ a: {target} }} = x);"),
            format!("for ({target} of x);"),
            format!("delete {target};"),
        ] {
            assert_mentions_in(TYPED_SCRIPT, &statement, &object);
        }
    }
    assert_mentions("[...module.id] = x;", &object);
    assert_mentions("({ ...module.loaded } = x);", &object);
    assert_mentions("[...module.paths] = x;", &object);
    assert_mentions_in(TYPED_SCRIPT, "(module.require as any) = f;", &object);
    assert_mentions_in(
        TYPED_SCRIPT,
        "(module.children as any) = 1;",
        &[
            ("module", OwnFile, Object),
            ("module.children", OwnFile, HandedOn),
        ],
    );
    assert_mentions_in(
        TYPED_SCRIPT,
        "(require.main as any) = 1;",
        &[("require.main", EntryPoint, Object)],
    );
    assert_mentions_in(
        TYPED_SCRIPT,
        "(module.id as any); f(module.id!);",
        &[
            ("module.id", OwnFile, Field(ModuleField::Id)),
            ("module.id", OwnFile, Field(ModuleField::Id)),
        ],
    );
}

#[test]
fn the_object_as_a_value() {
    for source in [
        "x === module;",
        "require.main === module && 1;",
        "module.hot;",
        "module.notThere = 1;",
        "module._compile(text, name);",
        "const { id } = module;",
        "module.require = f;",
        "delete module.exports;",
        "delete module[key];",
    ] {
        let found = ("module", OwnFile, Object);
        match source.starts_with("require.main") {
            true => assert_mentions(source, &[("require.main", EntryPoint, Object), found]),
            false => assert_mentions(source, &[found]),
        }
    }
    assert_mentions(
        "const m = require.main; m.exports;",
        &[("m", EntryPoint, Object)],
    );
    assert_mentions(
        "process.mainModule = 1;",
        &[("process.mainModule", EntryPoint, Object)],
    );
}

#[test]
fn the_object_where_nothing_follows_it() {
    for source in [
        "f(module);",
        "x = { module };",
        "x = [module];",
        "for (const each of [module]) {}",
        "module[key];",
        "Reflect.get(module, key);",
        "getter.call(module);",
        "module.__proto__;",
        "module.constructor;",
        "module.hasOwnProperty(key);",
    ] {
        assert_mentions(source, &[("module", OwnFile, HandedOn)]);
    }
    for source in [
        "const { constructor } = module;",
        "const { __proto__: above } = module;",
    ] {
        let expected = [("module", OwnFile, Object), ("module", OwnFile, HandedOn)];
        assert_mentions(source, &expected);
    }
    assert_mentions("const m = module; f(m);", &[("m", OwnFile, HandedOn)]);
    assert_mentions(
        "f(require.main);",
        &[("require.main", EntryPoint, HandedOn)],
    );
    assert_mentions(
        "x = [process.mainModule];",
        &[("process.mainModule", EntryPoint, HandedOn)],
    );
    assert_mentions(
        "f(module.children[0]);",
        &[
            ("module.children", OwnFile, Children),
            ("module.children[0]", Related, HandedOn),
        ],
    );
    assert_mentions(
        "for (const child of module.children) {}",
        &[("module.children", OwnFile, HandedOn)],
    );
    assert_mentions(
        "const { parent } = module; f(parent);",
        &[
            ("module", OwnFile, Object),
            ("module", OwnFile, Parent),
            ("parent", Related, HandedOn),
        ],
    );
}

#[test]
fn the_main_module_without_its_name() {
    assert_mentions("require[key];", &[("require[key]", EntryPoint, HandedOn)]);
    assert_mentions("process[key];", &[("process[key]", EntryPoint, HandedOn)]);
    assert_mentions("f(require);", &[("require", EntryPoint, HandedOn)]);
    assert_mentions("x = [require];", &[("require", EntryPoint, HandedOn)]);
    for source in [
        "Object.getPrototypeOf(require);",
        "Reflect.getPrototypeOf(require).main;",
        "require.__proto__.main;",
        "const { __proto__: above } = require;",
        "const { ...members } = require;",
    ] {
        assert_mentions(source, &[("require", EntryPoint, HandedOn)]);
    }
    for source in [
        "process.pid; f(process);",
        "Object.entries(process);",
        "x = { ...process };",
        "for (const key in process) {}",
        "process.__proto__ = x;",
        "process.constructor;",
        "const { __proto__: above } = process;",
        "const { constructor } = process;",
        "const { ...members } = process;",
        "const { [key]: member } = process;",
    ] {
        assert_mentions(source, &[("process", EntryPoint, HolderHandedOn)]);
    }
    for source in [
        "f(globalThis);",
        "const [root] = [globalThis];",
        "globalThis[key];",
        "const { ...globals } = globalThis;",
    ] {
        assert_mentions(source, &[("globalThis", EntryPoint, HolderHandedOn)]);
    }
    for source in [
        "(function () { return this; })();",
        "function f() { this[key]; }",
        "function f() { this.process.pid; }",
    ] {
        assert_mentions(source, &[("this", EntryPoint, HolderHandedOn)]);
    }
    for source in [
        "globalThis.own; globalThis.process.pid; typeof globalThis;",
        "function f() { 'use strict'; return this; }",
        "function f() { this.own; this.console; this.process = 1; }",
        "x = this;",
        "require[key] = 1;",
        "process[key] = 1;",
        "process.pid; typeof process; process && 1; Object.keys(process);",
        "typeof require; require.resolve;",
        "const { pid, env } = process; const { resolve } = require;",
    ] {
        assert_mentions(source, &[]);
    }
}

#[test]
fn where_no_expression_names_the_object() {
    // These two come to `require` too, and whoever has it reads its `main`.
    for source in ["eval(text);", "arguments;"] {
        let expected = [("", OwnFile, Object), ("", EntryPoint, HandedOn)];
        assert_mentions(source, &expected);
    }
    for source in [
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
        assert_mentions(source, &[("", OwnFile, Object)]);
    }
    assert_mentions("with (o) module;", &[("", OwnFile, Object)]);
}

#[test]
fn the_store_that_goes_along_with_module_exports() {
    let source = "exports = module.exports = f; function g() { exports = 1; }";
    with_case(SCRIPT, source, |case| {
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
    });
}

#[test]
fn tests_of_other_objects() {
    assert_mentions(
        "if (!module.parent) {} module.parent == null; typeof module.parent; module.parent && 1;",
        &[
            ("module.parent", OwnFile, ParentTested),
            ("module.parent", OwnFile, ParentTested),
            ("module.parent", OwnFile, ParentTested),
            ("module.parent", OwnFile, ParentTested),
        ],
    );
    assert_mentions(
        "!require.main; process.mainModule ? 1 : 2;",
        &[
            ("require.main", EntryPoint, Tested),
            ("process.mainModule", EntryPoint, Tested),
        ],
    );
    assert_mentions(
        "f(module.parent || 1); module.parent === x;",
        &[
            ("module.parent", OwnFile, HandedOn),
            ("module.parent", OwnFile, Parent),
        ],
    );
}

#[test]
fn along_children_and_parent() {
    assert_mentions(
        "const c = module.children; c.length; c[0].exports.x; c[0].parent === module;",
        &[
            ("module.children", OwnFile, Children),
            ("c[0].parent", Related, Parent),
            ("module", OwnFile, Object),
        ],
    );
    assert_mentions(
        "require.main.children[i].children; f(module.parent.parent);",
        &[
            ("require.main.children", EntryPoint, Children),
            ("require.main.children[i].children", Related, Children),
            ("module.parent", OwnFile, Parent),
            ("module.parent.parent", Related, HandedOn),
        ],
    );
    assert_mentions(
        "module.children = { push(child) {} };",
        &[
            ("module", OwnFile, Object),
            ("module.children", OwnFile, HandedOn),
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
        "const { parent } = module;",
        &[object, ("module", OwnFile, Parent)],
    );
    assert_mentions(
        "const { id, children: kids } = module;",
        &[object, ("module", OwnFile, Children)],
    );
    for source in [
        "const { id, ...others } = module;",
        "const { [key]: found } = module;",
    ] {
        assert_mentions(source, &[object, ("module", OwnFile, HandedOn)]);
    }
    assert_mentions(
        "const { parent: { children } } = module;",
        &[
            object,
            ("module", OwnFile, Parent),
            ("module", Related, Children),
        ],
    );
    assert_mentions(
        "const { children } = require.main;",
        &[
            ("require.main", EntryPoint, Object),
            ("require.main", EntryPoint, Children),
        ],
    );
    assert_mentions(
        "const { children } = module.parent;",
        &[
            ("module.parent", OwnFile, Parent),
            ("module.parent", Related, Children),
        ],
    );
    assert_mentions(
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
    assert_mentions_in(
        PROGRAM,
        &source,
        &[(
            "createRequire(import.meta.url).main.children",
            EntryPoint,
            HandedOn,
        )],
    );
    let source = format!("{import} let made = createRequire(\"/a\"); made = f; made.main;");
    assert_mentions_in(PROGRAM, &source, &[]);
}

#[test]
fn an_es_module_has_no_module_object() {
    assert_mentions_in(PROGRAM, "f(module); module.id; export {};", &[]);
    assert_mentions_in(
        PROGRAM,
        "require.main.id; export {};",
        &[("require.main", EntryPoint, Object)],
    );
}

#[test]
fn a_require_that_nobody_follows() {
    let import = "import { createRequire } from \"node:module\";";
    let source = format!("{import} f(createRequire(\"/a\"));");
    let handed_on = [("createRequire(\"/a\")", EntryPoint, HandedOn)];
    assert_mentions_in(PROGRAM, &source, &handed_on);
    let source = format!("{import} f(createRequire);");
    assert_mentions_in(PROGRAM, &source, &[("createRequire", EntryPoint, HandedOn)]);
}

#[test]
fn a_var_that_may_still_be_undefined_only_may_hold_the_object() {
    let kept = ("module", OwnFile, Object);
    for source in [
        "var m = module; m.id; m.filename; m.path; m.loaded; m.exports; m.paths;",
        "if (x) { var m = module; } m?.exports; m?.id;",
        "m.id; var m = module;",
        "function f() { return m.id; } var m = module;",
        "function f() { var m = module; return m.id; }",
        "var m = module; m.id = 1; m.exports = 2;",
    ] {
        assert_mentions(source, &[kept]);
    }
    with_case(SCRIPT, "var m = module; m.id; m.exports;", |case| {
        assert_unresolved(case, "m.id");
        assert_unresolved(case, "m.exports");
    });
    assert_mentions("var m = module; f(m);", &[kept, ("m", Related, HandedOn)]);
    assert_mentions(
        "var m = module; const n = m; n.id;",
        &[kept, ("m", Related, HandedOn)],
    );
    assert_mentions(
        "var m = module; m.parent.id;",
        &[kept, ("m.parent", Related, Parent)],
    );
    assert_mentions(
        "var r = require; r.main.id;",
        &[("r.main", EntryPoint, Object)],
    );
    assert_mentions(
        "var m = require.main; m.id;",
        &[
            ("require.main", EntryPoint, Object),
            ("m", EntryPoint, Object),
        ],
    );
    // A read ahead of the line of a `let` or a `const` throws.
    for source in [
        "let m = module; f(m.id);",
        "const m = module; const n = m; f(n.id);",
    ] {
        let name = if source.contains("n.id") { "n.id" } else { "m.id" };
        assert_mentions(source, &[(name, OwnFile, Field(ModuleField::Id))]);
    }
}

#[test]
fn what_may_store_the_path_of_the_main_module() {
    let may_store = |source: &str| {
        with_case(SCRIPT, source, |case| {
            case.resolved.may_store_path_of_main_module()
        })
    };
    for source in ["Bun.main = path;", "Bun[key] = path;", "f(Bun);"] {
        assert!(may_store(source), "{source}");
    }
    for source in ["Bun.main;", "typeof Bun;", "o.main = path;"] {
        assert!(!may_store(source), "{source}");
    }
}
