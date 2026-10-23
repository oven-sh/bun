use bun_sema::program::FileId;

use super::drop_unnamed_entries;
use crate::builtins::id::BuiltinClass;
use crate::ir::generated::{Field, Function, Layout, Variable};
use crate::ir::{DeclaredType, Id, PropertyKey, Type, TypeTable};
use crate::link::testing::{test_class_key, test_function_key, test_variable_key};
use crate::lower::fragment::{Fragment, FragmentBuilder, ModuleFragment};

const FILE: FileId = FileId(0);

fn declared(ty: crate::ir::TypeId) -> DeclaredType {
    DeclaredType {
        ty,
        ..DeclaredType::default()
    }
}

fn fragment_with_unnamed_entries() -> Fragment {
    let mut builder = FragmentBuilder::new(FILE);
    let module = builder.declare_module(crate::modules::ModuleRef::File(FILE));
    let classes = [0, 1, 2, 3].map(|class| builder.declare_layout(test_class_key(0, class)));
    builder.end_layouts_of_code();
    let late_class = builder.declare_layout(test_class_key(0, 4));
    let functions =
        [0, 1, 2].map(|function| builder.declare_function(test_function_key(0, function)));
    let variables = [0, 1].map(|symbol| builder.declare_variable(test_variable_key(0, symbol)));
    let names = [&b"unnamed"[..], b"field", b"function"].map(|name| builder.strings.intern(name));
    let keys = names.map(|name| {
        builder.property_keys.intern(PropertyKey {
            text: Some(name),
            ..PropertyKey::default()
        })
    });

    builder.types.intern(Type::layout(classes[0]));
    let element = builder.types.intern(Type::layout(classes[3]));
    builder.types.intern(Type::string_literal(names[0]));
    let list = builder
        .types
        .intern(Type::class(BuiltinClass::Array, &[element]));

    builder.define_function(
        functions[2],
        Function {
            name: Some(names[2]),
            module,
            ..Function::default()
        },
    );
    builder.define_layout(
        classes[1],
        Layout {
            fields: vec![Field {
                key: Some(keys[1]),
                declared: declared(list),
                ..Field::default()
            }],
            ..Layout::default()
        },
    );
    builder.define_layout(late_class, Layout::default());
    builder.define_variable(variables[1], Variable::default());
    builder.finish(ModuleFragment::default())
}

#[test]
fn entries_that_no_record_names_are_dropped_and_the_rest_keeps_its_order() {
    let mut fragment = fragment_with_unnamed_entries();
    drop_unnamed_entries(&mut fragment);

    assert_eq!(
        fragment.layout_keys,
        [1, 3, 4].map(|class| test_class_key(0, class))
    );
    assert_eq!(fragment.code_layout_count, 2);
    assert_eq!(fragment.function_keys, [test_function_key(0, 2)]);
    assert_eq!(fragment.variable_keys, [test_variable_key(0, 1)]);
    let strings: Vec<&[u8]> = fragment
        .strings
        .ids()
        .map(|id| fragment.strings.get(id))
        .collect();
    assert_eq!(strings, [&b"field"[..], b"function"]);
    assert_eq!(fragment.property_keys.len(), 1);
    assert_eq!(fragment.types.len(), TypeTable::WELL_KNOWN_COUNT + 2);

    let (function, record) = &fragment.functions[0];
    assert_eq!(function.index(), 0);
    assert_eq!(
        record.name.map(|name| fragment.strings.get(name)),
        Some(&b"function"[..])
    );
    let defined: Vec<usize> = fragment
        .layouts
        .iter()
        .map(|definition| definition.0.index())
        .collect();
    assert_eq!(defined, [0, 2]);
    let field = &fragment.layouts[0].1.fields[0];
    let key = fragment
        .property_keys
        .get(field.key.expect("the field has a key"));
    assert_eq!(
        key.text.map(|text| fragment.strings.get(text)),
        Some(&b"field"[..])
    );
    let element = fragment
        .types
        .iter()
        .nth(TypeTable::WELL_KNOWN_COUNT)
        .expect("the element's type");
    assert_eq!(*element, Type::layout(crate::ir::LayoutId::new(1)));
    assert_eq!(field.declared.ty.index(), TypeTable::WELL_KNOWN_COUNT + 1);
    assert_eq!(fragment.variables[0].0.index(), 0);
}

#[test]
fn fragment_without_unnamed_entries_stays_as_it_is() {
    let mut fragment = fragment_with_unnamed_entries();
    drop_unnamed_entries(&mut fragment);
    let counts = |fragment: &Fragment| {
        [
            fragment.strings.len(),
            fragment.property_keys.len(),
            fragment.types.len(),
            fragment.layout_keys.len(),
            fragment.function_keys.len(),
            fragment.variable_keys.len(),
            fragment.code_layout_count,
        ]
    };
    let before = counts(&fragment);
    drop_unnamed_entries(&mut fragment);
    assert_eq!(counts(&fragment), before);
}
