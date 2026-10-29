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
            then(
                files,
                declarations.expect("the declarations are a root file"),
            )
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

    /// The declarations that begin with `type`, each on one line, however many the formatter gave it.
    fn type_aliases(text: &[u8]) -> Vec<Vec<u8>> {
        let mut aliases: Vec<Vec<u8>> = Vec::new();
        let mut is_open = false;
        for line in trimmed_lines(text) {
            if is_open {
                let alias = aliases.last_mut().unwrap();
                alias.push(b' ');
                alias.extend_from_slice(line);
            } else if line.starts_with(b"type ") {
                aliases.push(line.to_vec());
            } else {
                continue;
            }
            is_open = line.ends_with(b"{") || (is_open && line != b"};");
        }
        aliases
    }

    #[test]
    fn every_build_has_them_as_types_only_and_global_bun_has_members_of_module() {
        with_application_files(&[("main.ts", "export {};")], |files, declarations| {
            assert_eq!(files.role(declarations), FileRole::TypesOnly);
            assert!(!files.is_compiled(declarations));
            assert!(!files.hir(declarations).has_errors);
            assert!(!files.module(declarations).is_module());
            assert!(files_declaring(files, bun_module(files)).contains(&declarations));
            let int32 = member_of(files, global_bun(files), b"int32");
            assert_eq!(files_declaring(files, int32), [declarations]);
        });
    }

    #[test]
    fn names_stay_theirs_where_other_files_declare_them() {
        with_application_files(&PROGRAM_WITH_OTHER_DECLARATIONS, |files, declarations| {
            for container in [bun_module(files), global_bun(files)] {
                let int32 = member_of(files, container, b"int32");
                assert_eq!(files_declaring(files, int32), [declarations]);
                let inspect = member_of(files, container, b"inspect");
                assert!(!files_declaring(files, inspect).contains(&declarations));
            }
        });
    }

    #[test]
    fn tagged_aliases_are_written_as_in_bun_types() {
        let mut aliases = type_aliases(TEXT);
        aliases.retain(|alias| contains(alias, b"\"bun."));
        assert_eq!(aliases.len(), 1);
        let published = type_aliases(BUN_TYPES);
        for alias in aliases {
            assert!(published.contains(&alias), "{}", BStr::new(&alias));
        }
    }
}
