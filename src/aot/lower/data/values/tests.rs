use bstr::BStr;
use bun_ast::Log;
use bun_sema::atom::Interner;
use bun_sema::fold::{Define, DefinePath, DefineRoot, DefineValue, FoldOptions};
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::session::Arena;

use crate::compile::testing::{
    default_settings, lower_program_with_provider, lower_program_with_settings,
};
use crate::diagnostic_codes::Code;
use crate::ir::generated::{Data, DataMember, DataNode};
use crate::ir::{Id, LayoutId, LayoutKey, StringId, TypeTable};
use crate::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, MacroCall, ModuleName, Resolution, ResolveRequest,
    SourceFile, SourceProvider, WithoutServices,
};
use crate::lower::Fragment;
use crate::modules::ModuleRef;
use crate::statistics::{LimitId, LimitValues};

const DEFINED_NAME: &[u8] = b"PROBE_DATA";
const NESTING_DEPTH: usize = 1900;
const MAIN_FILE: (&str, &str) = (
    "main.js",
    "import value from \"./data.json\";\nexport default value;\n",
);

type CreateValue = for<'s> fn(&'s Arena, &Interner<'s>) -> DataValue<'s>;

struct DefinedData(CreateValue);

impl SourceProvider for DefinedData {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        let define = Define {
            path: DefinePath {
                root: DefineRoot::Global(atoms.intern(DEFINED_NAME)),
                members: &[],
            },
            value: DefineValue::Data(arena.alloc((self.0)(arena, atoms))),
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

    fn run_macro<'s>(
        &self,
        call: &MacroCall<'_, 's>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<&'s DataValue<'s>, Failed> {
        WithoutServices.run_macro(call, arena, atoms, log)
    }

    fn bundle_pages<'s>(
        &self,
        pages: &[&[u8]],
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<Vec<&'s DataValue<'s>>, Failed> {
        WithoutServices.bundle_pages(pages, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

fn create_undefined_and_bigint<'s>(arena: &'s Arena, atoms: &Interner<'s>) -> DataValue<'s> {
    let items = [DataValue::Undefined, DataValue::BigInt(atoms.intern(b"12"))];
    DataValue::Array(arena.alloc_slice_copy(&items))
}

fn create_nested_arrays<'s>(arena: &'s Arena, _: &Interner<'s>) -> DataValue<'s> {
    let mut nested = DataValue::Array(&[]);
    for _ in 1..NESTING_DEPTH {
        nested = DataValue::Array(arena.alloc_slice_copy(&[nested]));
    }
    nested
}

fn lower_data_module(json: &str) -> Vec<Fragment> {
    let files = [MAIN_FILE, ("data.json", json)];
    let lowered = lower_program_with_settings(&files, &default_settings());
    lowered
        .into_iter()
        .map(|(_, lowered)| lowered.fragment)
        .collect()
}

fn data_of(json: &str) -> (Fragment, Data) {
    let mut fragments = lower_data_module(json);
    fragments.retain(|fragment| fragment.module.data.is_some());
    assert_eq!(fragments.len(), 1, "one module of the program is data");
    let mut fragment = fragments.remove(0);
    let id = fragment
        .module
        .data
        .expect("the other fragments were removed");
    let data = core::mem::take(&mut fragment.data[id.index()]);
    (fragment, data)
}

fn defined_data_of(create_value: CreateValue) -> (Fragment, Data) {
    let files = [("main.js", "export const probe = PROBE_DATA;\n")];
    let provider = DefinedData(create_value);
    let mut lowered = lower_program_with_provider(&files, &default_settings(), &provider);
    assert_eq!(lowered.len(), 1);
    let mut fragment = lowered.remove(0).1.fragment;
    assert_eq!(fragment.data.len(), 1, "the program reads the define once");
    let data = fragment.data.remove(0);
    (fragment, data)
}

fn elements_of(node: &DataNode) -> &[DataNode] {
    let DataNode::Array { elements, .. } = node else {
        panic!("expected an array, found {node:?}");
    };
    elements
}

fn members_of(node: &DataNode) -> &[DataMember] {
    let DataNode::Object { members, .. } = node else {
        panic!("expected an object, found {node:?}");
    };
    members
}

fn layout_of(node: &DataNode) -> LayoutId {
    let DataNode::Object { layout, .. } = node else {
        panic!("expected an object, found {node:?}");
    };
    *layout
}

fn text_of(fragment: &Fragment, id: StringId) -> &BStr {
    BStr::new(fragment.strings.get(id))
}

fn key_texts<'a>(fragment: &'a Fragment, node: &DataNode) -> Vec<&'a BStr> {
    let keys = members_of(node).iter().map(|member| member.key);
    keys.map(|key| {
        let text = fragment.property_keys.get(key).text;
        text_of(fragment, text.expect("the key of a data member is a text"))
    })
    .collect()
}

fn count_nested_arrays(mut node: DataNode) -> usize {
    let mut depth = 0;
    while let DataNode::Array { mut elements, .. } = node {
        depth += 1;
        let Some(inner) = elements.pop() else {
            break;
        };
        node = inner;
    }
    depth
}

#[test]
fn primitives_become_leaves() {
    let (fragment, data) = data_of(r#"[null, true, 1.5, -0, "a"]"#);
    let [
        DataNode::Null,
        DataNode::Boolean { value: true },
        DataNode::Number { value: fraction },
        DataNode::Number { value: zero },
        DataNode::String { value: text },
    ] = elements_of(&data.root)
    else {
        panic!("{:?}", data.root);
    };
    assert_eq!(*fraction, 1.5);
    assert!(*zero == 0.0 && zero.is_sign_negative());
    assert_eq!(text_of(&fragment, *text), "a");
}

#[test]
fn undefined_and_bigint_become_leaves() {
    let (fragment, data) = defined_data_of(create_undefined_and_bigint);
    let [DataNode::Undefined, DataNode::BigInt { digits }] = elements_of(&data.root) else {
        panic!("{:?}", data.root);
    };
    assert_eq!(text_of(&fragment, *digits), "12");
}

#[test]
fn array_contents_are_untyped() {
    let (_, data) = data_of("[1, 2]");
    let DataNode::Array { contents, .. } = data.root else {
        panic!("{:?}", data.root);
    };
    assert_eq!(contents, TypeTable::ANYTHING);
}

#[test]
fn members_stay_in_insertion_order() {
    let (fragment, data) = data_of(r#"{"b": 1, "a": 2}"#);
    assert_eq!(key_texts(&fragment, &data.root), ["b", "a"]);
    let values: Vec<&DataNode> = members_of(&data.root)
        .iter()
        .map(|member| &member.value)
        .collect();
    assert_eq!(
        values,
        [
            &DataNode::Number { value: 1.0 },
            &DataNode::Number { value: 2.0 }
        ]
    );
}

#[test]
fn nested_values_stay_under_parents() {
    let (fragment, data) = data_of(r#"{"list": [1, {"deep": true}, []], "last": {}}"#);
    assert_eq!(key_texts(&fragment, &data.root), ["list", "last"]);
    let [list, last] = members_of(&data.root) else {
        panic!("{:?}", data.root);
    };
    let [first, second, third] = elements_of(&list.value) else {
        panic!("{:?}", list.value);
    };
    assert_eq!(*first, DataNode::Number { value: 1.0 });
    assert_eq!(key_texts(&fragment, second), ["deep"]);
    assert_eq!(
        members_of(second)[0].value,
        DataNode::Boolean { value: true }
    );
    assert!(elements_of(third).is_empty());
    assert!(members_of(&last.value).is_empty());
}

#[test]
fn equal_key_sets_share_layout() {
    let json = r#"[{"a": 1, "b": 2}, {"a": 3, "b": 4}, {"b": 5, "a": 6}, {"a": 7}]"#;
    let (fragment, data) = data_of(json);
    let rows = elements_of(&data.root);
    let layouts: Vec<LayoutId> = rows.iter().map(layout_of).collect();
    assert_eq!(layouts.len(), 4);
    assert_eq!(layouts[0], layouts[1]);
    assert_eq!(layouts[0], layouts[2]);
    assert_ne!(layouts[0], layouts[3]);
    assert_eq!(key_texts(&fragment, &rows[2]), ["b", "a"]);
}

#[test]
fn object_layout_belongs_to_data_file() {
    let (fragment, data) = data_of(r#"{"name": "x"}"#);
    let key = fragment.layout_keys[layout_of(&data.root).index()];
    let LayoutKey::UntypedLiteral { file, .. } = key else {
        panic!("{key:?}");
    };
    assert_eq!(file, fragment.file);
}

#[test]
fn proto_key_is_member() {
    let (fragment, data) = data_of(r#"{"__proto__": 1}"#);
    assert_eq!(key_texts(&fragment, &data.root), ["__proto__"]);
    assert_eq!(
        members_of(&data.root)[0].value,
        DataNode::Number { value: 1.0 }
    );
}

#[test]
fn index_like_key_is_member() {
    let (fragment, data) = data_of(r#"{"404": 1, "a": 2}"#);
    assert_eq!(key_texts(&fragment, &data.root), ["404", "a"]);
}

#[test]
fn deep_value_needs_no_stack() {
    let (_, data) = defined_data_of(create_nested_arrays);
    assert_eq!(count_nested_arrays(data.root), NESTING_DEPTH);
}

fn count_nesting_errors(depth: usize) -> usize {
    let json = "[".repeat(depth) + &"]".repeat(depth);
    let files = [MAIN_FILE, ("data.json", json.as_str())];
    let lowered = lower_program_with_settings(&files, &default_settings());
    let diagnostics = lowered.iter().flat_map(|(_, file)| file.diagnostics.iter());
    diagnostics
        .filter(|diagnostic| diagnostic.code == Code::NestedTooDeeply)
        .count()
}

#[test]
fn data_past_nesting_limit_is_an_error() {
    let limit = LimitValues::for_host().get(LimitId::MaxNestingDepth) as usize;
    assert_eq!(count_nesting_errors(limit), 0);
    assert_eq!(count_nesting_errors(limit + 1), 1);
}

#[test]
fn primitive_module_has_no_record() {
    let fragments = lower_data_module("\"text\"");
    assert_eq!(fragments.len(), 2);
    for fragment in fragments {
        assert_eq!(fragment.module.data, None);
        assert!(fragment.data.is_empty());
    }
}

#[test]
fn record_names_module() {
    let (fragment, data) = data_of("[1]");
    let module = data
        .module
        .expect("a record names the module that creates it");
    assert_eq!(
        fragment.module_keys[module.index()],
        ModuleRef::File(fragment.file)
    );
}
