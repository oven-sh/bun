use super::CodeImportKind::{EntryPoint, Import, Require};
use super::*;

#[derive(Clone, Debug)]
pub struct ExtensionOrders {
    pub import: Vec<Vec<u8>>,
    pub require: Vec<Vec<u8>>,
    pub node_modules_import: Vec<Vec<u8>>,
    pub node_modules_require: Vec<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct CodeOptions {
    pub working_directory: Vec<u8>,
    pub conditions: Vec<Vec<u8>>,
    pub custom_conditions: Vec<Vec<u8>>,
    pub prefers_module_field: bool,
    pub extension_orders: ExtensionOrders,
    pub preserves_symlinks: bool,
    pub node_paths: Vec<Vec<u8>>,
    pub tsconfig_override: Option<Vec<u8>>,
    pub transpiles_by_working_directory: bool,
    pub jsx: JsxSettings,
    pub forced_jsx_development: Option<bool>,
    pub max_computed_candidates: u32,
}

/// The condition of `exports` and `imports` that names what `--aot` compiles.
pub const AOT_CONDITION: &[u8] = b"aot";

fn byte_strings(texts: &[&str]) -> Vec<Vec<u8>> {
    texts.iter().map(|text| text.as_bytes().to_vec()).collect()
}

impl Options {
    pub fn transpile_as(&mut self, other: &Options) {
        self.experimental_decorators = other.experimental_decorators;
        self.emit_decorator_metadata = other.emit_decorator_metadata;
        self.jsx = other.jsx;
        self.jsx_import_source.clone_from(&other.jsx_import_source);
        self.jsx_runtime.clone_from(&other.jsx_runtime);
        self.jsx_factory.clone_from(&other.jsx_factory);
        self.jsx_fragment_factory
            .clone_from(&other.jsx_fragment_factory);
        self.react_namespace.clone_from(&other.react_namespace);
    }
}

impl CodeOptions {
    pub fn bun_run(working_directory: &[u8]) -> CodeOptions {
        let mut options = CodeOptions {
            working_directory: working_directory.to_vec(),
            conditions: byte_strings(&["bun", "node", "node-addons"]),
            custom_conditions: Vec::new(),
            prefers_module_field: false,
            extension_orders: ExtensionOrders::bun_run(),
            preserves_symlinks: false,
            node_paths: Vec::new(),
            tsconfig_override: None,
            transpiles_by_working_directory: false,
            jsx: JsxSettings::default(),
            forced_jsx_development: None,
            max_computed_candidates: 1024,
        };
        options.add_custom_condition(AOT_CONDITION);
        options
    }

    pub fn remove_condition(&mut self, condition: &[u8]) {
        for list in [&mut self.conditions, &mut self.custom_conditions] {
            list.retain(|it| it != condition);
        }
    }

    pub fn add_custom_condition(&mut self, condition: &[u8]) {
        for list in [&mut self.conditions, &mut self.custom_conditions] {
            if !list.iter().any(|it| it == condition) {
                list.push(condition.to_vec());
            }
        }
    }

    pub(super) fn matches_condition(&self, condition: &[u8], kind: CodeImportKind) -> bool {
        let kind_condition: &[u8] = match kind {
            EntryPoint | Import => b"import",
            Require => b"require",
        };
        condition == b"default"
            || condition == kind_condition
            || self.conditions.iter().any(|it| it == condition)
    }
}

impl ExtensionOrders {
    fn bun_run() -> ExtensionOrders {
        ExtensionOrders {
            import: byte_strings(&[
                ".tsx", ".jsx", ".mts", ".ts", ".mjs", ".js", ".cts", ".cjs", ".json",
            ]),
            require: byte_strings(&[
                ".tsx", ".ts", ".jsx", ".cts", ".cjs", ".js", ".mjs", ".mts", ".json", ".node",
            ]),
            node_modules_import: byte_strings(&[
                ".mjs", ".jsx", ".mts", ".js", ".cjs", ".tsx", ".ts", ".cts", ".json",
            ]),
            node_modules_require: byte_strings(&[
                ".jsx", ".cjs", ".js", ".mjs", ".mts", ".tsx", ".ts", ".cts", ".json", ".node",
            ]),
        }
    }

    pub(super) fn for_kind(&self, kind: CodeImportKind, is_in_node_modules: bool) -> &[Vec<u8>] {
        match (kind, is_in_node_modules) {
            (EntryPoint | Import, false) => &self.import,
            (EntryPoint | Import, true) => &self.node_modules_import,
            (Require, false) => &self.require,
            (Require, true) => &self.node_modules_require,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_match(options: &CodeOptions, condition: &str, kind: CodeImportKind) -> bool {
        options.matches_condition(condition.as_bytes(), kind)
    }

    #[test]
    fn orders_by_kind() {
        let orders = CodeOptions::bun_run(b"/p").extension_orders;
        let expected: [(CodeImportKind, bool, &[u8], &[u8]); 6] = [
            (EntryPoint, false, b".tsx", b".json"),
            (Import, false, b".tsx", b".json"),
            (EntryPoint, true, b".mjs", b".json"),
            (Import, true, b".mjs", b".json"),
            (Require, false, b".tsx", b".node"),
            (Require, true, b".jsx", b".node"),
        ];
        for (kind, is_in_node_modules, first, last) in expected {
            let order = orders.for_kind(kind, is_in_node_modules);
            assert_eq!(order.first().unwrap(), first);
            assert_eq!(order.last().unwrap(), last);
        }

        let has_node = |order: &[Vec<u8>]| order.iter().any(|extension| extension == b".node");
        assert!(has_node(&orders.require));
        assert!(has_node(&orders.node_modules_require));
        assert!(!has_node(&orders.import));
        assert!(!has_node(&orders.node_modules_import));
    }

    #[test]
    fn conditions_by_kind() {
        let options = CodeOptions::bun_run(b"/p");
        assert!(is_match(&options, "import", Import));
        assert!(is_match(&options, "import", EntryPoint));
        assert!(!is_match(&options, "import", Require));
        assert!(is_match(&options, "require", Require));
        assert!(!is_match(&options, "require", Import));
        assert!(!is_match(&options, "require", EntryPoint));

        let mut without_aot = options.clone();
        without_aot.remove_condition(AOT_CONDITION);
        for kind in [EntryPoint, Import, Require] {
            for condition in ["default", "bun", "node", "node-addons", "aot"] {
                assert!(is_match(&options, condition, kind), "{condition}");
            }
            for condition in ["browser", "module", "types"] {
                assert!(!is_match(&options, condition, kind), "{condition}");
            }
            assert!(!is_match(&without_aot, "aot", kind));
        }
    }

    #[test]
    fn custom_conditions_are_kept_apart() {
        let mut options = CodeOptions::bun_run(b"/p");
        assert_eq!(options.custom_conditions, byte_strings(&["aot"]));
        for condition in ["worker", "bun", "worker"] {
            options.add_custom_condition(condition.as_bytes());
        }
        let all = byte_strings(&["bun", "node", "node-addons", "aot", "worker"]);
        assert_eq!(options.conditions, all);
        let custom = byte_strings(&["aot", "worker", "bun"]);
        assert_eq!(options.custom_conditions, custom);
    }

    #[test]
    fn computed_specifiers_have_a_limit() {
        assert!(CodeOptions::bun_run(b"/p").max_computed_candidates > 0);
    }
}
