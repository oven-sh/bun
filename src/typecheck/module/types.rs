// internal/module/types.go 47-79: the package of a resolved module and the resolved module that a program answers. `ResolutionDiagnostics` belongs to the resolver and has no field.

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct PackageId<'p> {
    pub name: &'p [u8],
    pub sub_module_name: &'p [u8],
    pub version: &'p [u8],
    pub peer_dependencies: &'p [u8],
}

impl PackageId<'_> {
    pub fn string(&self) -> Vec<u8> {
        [
            self.package_name().as_slice(),
            b"@",
            self.version,
            self.peer_dependencies,
        ]
        .concat()
    }

    pub fn package_name(&self) -> Vec<u8> {
        if !self.sub_module_name.is_empty() {
            return [self.name, b"/", self.sub_module_name].concat();
        }
        self.name.to_vec()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct ResolvedModule<'p> {
    pub resolved_file_name: &'p [u8],
    pub original_path: &'p [u8],
    pub extension: &'p [u8],
    pub resolved_using_ts_extension: bool,
    pub resolved_using_extra_extensions: bool,
    pub package_id: PackageId<'p>,
    pub is_external_library_import: bool,
    pub alternate_result: &'p [u8],
}

impl ResolvedModule<'_> {
    // The nil module of upstream is the `None` of a program's answer: a module that is there is resolved when it has a file name.
    pub fn is_resolved(&self) -> bool {
        !self.resolved_file_name.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_id_names() {
        let mut id = PackageId {
            name: b"@scope/pkg",
            version: b"1.2.3",
            ..PackageId::default()
        };
        assert_eq!(id.package_name(), b"@scope/pkg");
        assert_eq!(id.string(), b"@scope/pkg@1.2.3");
        id.sub_module_name = b"sub/index.d.ts";
        id.peer_dependencies = b"+peer@4";
        assert_eq!(id.package_name(), b"@scope/pkg/sub/index.d.ts");
        assert_eq!(id.string(), b"@scope/pkg/sub/index.d.ts@1.2.3+peer@4");
    }

    #[test]
    fn resolved_module_is_resolved() {
        assert!(!ResolvedModule::default().is_resolved());
        let module = ResolvedModule {
            resolved_file_name: b"/a.ts",
            ..ResolvedModule::default()
        };
        assert!(module.is_resolved());
    }
}
