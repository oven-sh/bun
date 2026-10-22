pub(crate) use bun_sema::check::aot::COMPILER_DECLARATIONS_PATH as PATH;

pub(crate) const TEXT: &[u8] = include_bytes!("../prelude/bun-intrinsics.d.ts");

#[cfg(test)]
mod tests {
    use bstr::BStr;
    use bun_core::strings::{contains, split};
    use bun_sema::bind::SymFlags;
    use bun_sema::program::{FileId, FileRole, Files, Sym};

    use super::*;
    use crate::compile::testing::{default_settings, with_loaded_build};
    use crate::load::project::ProjectId;

    const BUN_TYPES: &[u8] = include_bytes!("../../../packages/bun-types/bun.d.ts");
    const TAGGED_ALIAS_COUNT: usize = 17;
    const EMPTY_PROGRAM: [(&str, &str); 1] = [("main.ts", "export {};")];
    const PROGRAM_WITH_OTHER_DECLARATIONS: [(&str, &str); 3] = [
        (
            "main.ts",
            "/// <reference path=\"./other.d.ts\" />\n\
             /// <reference path=\"./other-global.d.ts\" />\n\
             export {};",
        ),
        (
            "other.d.ts",
            "declare module \"bun\" {\n\
               type int32 = string;\n\
               namespace Schema {\n\
                 type Min<N extends number> = string;\n\
               }\n\
               function inspect(value: unknown): string;\n\
             }\n",
        ),
        (
            "other-global.d.ts",
            "import * as BunModule from \"bun\";\n\
             declare global {\n\
               export import Bun = BunModule;\n\
             }\n",
        ),
    ];

    fn with_application_files<R>(
        sources: &[(&str, &str)],
        then: impl FnOnce(&Files<'_>, FileId) -> R,
    ) -> R {
        with_loaded_build(sources, &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let declarations = files.by_path.get(PATH);
            then(files, declarations.expect("the declarations are a root file"))
        })
    }

    fn bun_module(files: &Files<'_>) -> Sym {
        let module = files
            .atoms
            .lookup(b"bun")
            .and_then(|specifier| files.try_find_ambient_module(specifier));
        module.expect("no file declares the module")
    }

    fn global_bun(files: &Files<'_>) -> Sym {
        let global = files
            .atoms
            .lookup(b"Bun")
            .and_then(|name| files.global(name, SymFlags::NAMESPACE))
            .and_then(|global| files.resolve_alias_as(global, SymFlags::NAMESPACE));
        files.canonical(global.expect("no file declares the global"))
    }

    fn member_of(files: &Files<'_>, container: Sym, name: &[u8]) -> Sym {
        let member = files
            .atoms
            .lookup(name)
            .and_then(|name| files.namespace_member(container, name));
        let member = member.unwrap_or_else(|| panic!("no member {}", BStr::new(name)));
        files.canonical(member)
    }

    fn files_declaring(files: &Files<'_>, symbol: Sym) -> Vec<FileId> {
        let declarations = files.decls_of(symbol);
        declarations.iter().map(|&(file, _)| file).collect()
    }

    fn trimmed_lines(text: &[u8]) -> impl Iterator<Item = &[u8]> {
        split(text, b"\n").map(<[u8]>::trim_ascii)
    }

    #[test]
    fn every_build_has_them_as_types_only() {
        with_application_files(&EMPTY_PROGRAM, |files, declarations| {
            assert_eq!(files.role(declarations), FileRole::TypesOnly);
            assert!(!files.is_compiled(declarations));
            assert!(!files.hir(declarations).has_errors);
            assert!(!files.module(declarations).is_module());
            assert_eq!(files_declaring(files, bun_module(files)), [declarations]);
        });
    }

    #[test]
    fn global_bun_has_members_of_module() {
        with_application_files(&EMPTY_PROGRAM, |files, declarations| {
            let global = global_bun(files);
            let schema = member_of(files, global, b"Schema");
            for member in [member_of(files, global, b"int32"), member_of(files, schema, b"Int")] {
                assert_eq!(files_declaring(files, member), [declarations]);
            }
        });
    }

    #[test]
    fn names_stay_theirs_where_other_files_declare_them() {
        with_application_files(&PROGRAM_WITH_OTHER_DECLARATIONS, |files, declarations| {
            for container in [bun_module(files), global_bun(files)] {
                let schema = member_of(files, container, b"Schema");
                let theirs = [
                    member_of(files, container, b"int32"),
                    member_of(files, schema, b"Min"),
                ];
                for member in theirs {
                    assert_eq!(files_declaring(files, member), [declarations]);
                }
                let inspect = member_of(files, container, b"inspect");
                assert!(!files_declaring(files, inspect).contains(&declarations));
            }
        });
    }

    #[test]
    fn tagged_aliases_are_written_as_in_bun_types() {
        let aliases: Vec<&[u8]> = trimmed_lines(TEXT)
            .filter(|line| line.starts_with(b"type ") && contains(line, b"\"bun."))
            .collect();
        assert_eq!(aliases.len(), TAGGED_ALIAS_COUNT);
        for alias in aliases {
            let is_in_bun_types = trimmed_lines(BUN_TYPES).any(|line| line == alias);
            assert!(is_in_bun_types, "{}", BStr::new(alias));
        }
    }
}
