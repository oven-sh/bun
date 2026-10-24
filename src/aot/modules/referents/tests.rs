use super::*;
use crate::builtins::{BuiltinName, RuntimeModule};
use crate::modules::BindInput;
use crate::modules::testing::{file_named, symbol_named, with_graph};
use bun_sema::bind::{
    BindingStability, NamespaceReferent, StaticReferent, UnknownReferent, symbol_referent,
};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::ClassId;
use bun_sema::program::Sym;

type Referent = StaticReferent<BuiltinId, ModuleRef>;

const UNLINKED_IMPORT: Referent = StaticReferent::Unknown(UnknownReferent::UnlinkedImport);
const CLASS_FILE: (&str, &str) = ("a.js", "export class A {}\n");

pub(super) struct BoundProgram<'a, 'i, 's> {
    pub(super) graph: &'a ModuleGraph,
    pub(super) input: &'a BindInput<'i, 's>,
}

pub(super) fn with_program(files: &[(&str, &str)], check: impl FnOnce(&BoundProgram<'_, '_, '_>)) {
    with_graph(files, |graph, input| check(&BoundProgram { graph, input }));
}

impl<'s> BoundProgram<'_, '_, 's> {
    pub(super) fn project(&self) -> LinkedProject<'_, 's> {
        LinkedProject {
            files: self.input.files,
            graph: self.graph,
            builtin_names: self.input.builtin_names,
            platform: self.input.platform,
            library: None,
        }
    }

    fn namespace(&self, name: &str) -> Referent {
        let module = ModuleRef::File(file_named(self.input, name));
        StaticReferent::Namespace(NamespaceReferent::Module(module))
    }

    fn first_class(&self, name: &str) -> Referent {
        StaticReferent::Class(ClassRef {
            file: file_named(self.input, name),
            class: ClassId(0),
        })
    }

    fn referent(&self, file: &str, local_name: &str) -> Referent {
        let file = file_named(self.input, file);
        let id = symbol_named(self.input, file, local_name);
        symbol_referent(&self.project(), Sym { file, id }).referent
    }

    fn builtin_name(&self, text: &str) -> BuiltinName {
        let atom = self.input.files.atoms.intern(text.as_bytes());
        let name = self.input.builtin_names.get(atom);
        name.expect("the table of built-ins has no such name")
    }
}

#[test]
fn imported_class_is_found_across_files() {
    let files = [
        (
            "main.ts",
            "import { A } from './a';\nconst used = A;\nconsole.log(used);\n",
        ),
        ("a.ts", "export class A {}\n"),
    ];
    with_program(&files, |program| {
        let class = program.first_class("a.ts");
        assert_eq!(program.referent("main.ts", "A"), class);
        assert_eq!(program.referent("main.ts", "used"), class);
    });
}

#[test]
fn namespace_member_class_is_found() {
    let main = "import * as ns from './a.js';\nconst used = ns.A;\nconsole.log(used);\n";
    with_program(&[("main.js", main), CLASS_FILE], |program| {
        assert_eq!(program.referent("main.js", "ns"), program.namespace("a.js"));
        assert_eq!(
            program.referent("main.js", "used"),
            program.first_class("a.js")
        );
    });
}

#[test]
fn re_exported_class_is_found() {
    let main = "
        import { A as named } from './named.js';
        import { A as star } from './star.js';
        import * as barrel from './named.js';
        const member = barrel.A;
        console.log(named, star, member);
    ";
    let files = [
        ("main.js", main),
        ("named.js", "export { A } from './a.js';\n"),
        ("star.js", "export * from './a.js';\n"),
        CLASS_FILE,
    ];
    with_program(&files, |program| {
        let class = program.first_class("a.js");
        for local_name in ["named", "star", "member"] {
            assert_eq!(
                program.referent("main.js", local_name),
                class,
                "{local_name}"
            );
        }
    });
}

#[test]
fn nested_namespace_member_is_found() {
    let main = "
        import * as outer from './outer.js';
        const used = outer.inner.A;
        console.log(used);
    ";
    let files = [
        ("main.js", main),
        ("outer.js", "export * as inner from './a.js';\n"),
        CLASS_FILE,
    ];
    with_program(&files, |program| {
        assert_eq!(
            program.referent("main.js", "used"),
            program.first_class("a.js")
        );
    });
}

#[test]
fn deferred_namespace_is_unknown() {
    let main = "
        import defer * as ns from './a.js';
        import * as holder from './holder.js';
        const used = ns.A;
        const indirect = holder.later.A;
        console.log(used, indirect);
    ";
    let holder = "import defer * as later from './a.js';\nexport { later };\n";
    let files = [("main.js", main), ("holder.js", holder), CLASS_FILE];
    with_program(&files, |program| {
        for local_name in ["ns", "used", "indirect"] {
            let referent = program.referent("main.js", local_name);
            assert_eq!(referent, UNLINKED_IMPORT, "{local_name}");
        }
        assert_eq!(
            program.referent("main.js", "holder"),
            program.namespace("holder.js")
        );
    });
}

#[test]
fn commonjs_import_is_unknown() {
    let main = "
        import { A } from './legacy.cjs';
        import * as ns from './legacy.cjs';
        const member = ns.A;
        console.log(A, member);
    ";
    let files = [("main.js", main), ("legacy.cjs", "exports.A = class {};\n")];
    with_program(&files, |program| {
        assert_eq!(program.referent("main.js", "A"), UNLINKED_IMPORT);
        assert_eq!(program.referent("main.js", "member"), UNLINKED_IMPORT);
        assert_eq!(
            program.referent("main.js", "ns"),
            program.namespace("legacy.cjs")
        );
    });
}

#[test]
fn uncompiled_code_import_is_unknown() {
    let main = "
        import { A } from 'https://example.com/a.js';
        import { A as indirect } from './barrel.js';
        console.log(A, indirect);
    ";
    let files = [
        ("main.js", main),
        (
            "barrel.js",
            "export { A } from 'https://example.com/a.js';\n",
        ),
    ];
    with_program(&files, |program| {
        assert_eq!(program.referent("main.js", "A"), UNLINKED_IMPORT);
        assert_eq!(program.referent("main.js", "indirect"), UNLINKED_IMPORT);
    });
}

#[test]
fn builtin_import_is_builtin() {
    let main = "
        import { EventEmitter } from 'node:events';
        import * as events from 'node:events';
        console.log(EventEmitter, events);
    ";
    with_program(&[("main.js", main)], |program| {
        let namespace = table::canonical_id(table::namespace_of(RuntimeModule::NodeEvents));
        let member = table::own_member(namespace, program.builtin_name("EventEmitter"));
        let member = member.expect("node:events lists EventEmitter");
        assert_eq!(
            program.referent("main.js", "EventEmitter"),
            StaticReferent::Builtin(table::canonical_id(member))
        );
        let module = ModuleRef::Runtime(RuntimeModule::NodeEvents);
        assert_eq!(
            program.referent("main.js", "events"),
            StaticReferent::Namespace(NamespaceReferent::Module(module))
        );
    });
}

#[test]
fn global_class_is_builtin() {
    let main = "const used = Map;\nconsole.log(used);\nexport {};\n";
    with_program(&[("main.js", main)], |program| {
        let global = table::global(program.builtin_name("Map"));
        let global = global.expect("Map is a global");
        let StaticReferent::Builtin(found) = program.referent("main.js", "used") else {
            panic!("a reference to a global class is a built-in");
        };
        assert_eq!(table::canonical_id(found), table::canonical_id(global));
    });
}

#[test]
fn absent_member_is_unknown() {
    let main = "import * as ns from './a.js';\nconst used = ns.Missing;\nconsole.log(used);\n";
    with_program(&[("main.js", main), CLASS_FILE], |program| {
        assert_eq!(program.referent("main.js", "used"), UNLINKED_IMPORT);
        assert!(program.graph.errors().is_empty());
    });
}

#[test]
fn store_in_dead_code_is_ignored() {
    let main = "
        let stable = class {};
        let replaced = class {};
        if (false) stable = null;
        if (globalThis.flag) replaced = null;
        console.log(stable, replaced);
        export {};
    ";
    with_program(&[("main.js", main)], |program| {
        assert_eq!(
            program.referent("main.js", "stable"),
            program.first_class("main.js")
        );
        let stored = UnknownReferent::UnstableBinding(BindingStability::Stored);
        assert_eq!(
            program.referent("main.js", "replaced"),
            StaticReferent::Unknown(stored)
        );
    });
}
