//! Functions that are written in JavaScript with `@names`: those of the standard library, and those of the embedder.

use core::cell::{LazyCell, OnceCell, RefCell};

use bun_engine_bytecode::{
    BuiltinFunction, BuiltinValue, FunctionInfo, FunctionKind, FunctionRef, Host, Visibility,
};
use bun_engine_macros::FieldOffsets;
use bun_engine_text::{Atom, Identifier, PropertyName, StringRef, SymbolRef, Text};

use super::builtin_values::BUILTIN_VALUES;
use crate::{
    BuiltinId, FastHashMap, FunctionExecutable, Gc, RealmSlot, SourceCode, SourceProvider,
    SourceProviderRef, SourceType, Vm,
};

#[derive(Default)]
pub(super) struct Builtins {
    functions: RefCell<FastHashMap<u16, (SourceProviderRef, FunctionRef)>>,
    /// By the address of the text.
    embedder_functions: RefCell<FastHashMap<usize, UnlinkedFunction>>,
    values: LazyCell<BuiltinValues>,
    embedder_names: RefCell<FastHashMap<Identifier, Identifier>>,
    /// Of base and of derived classes.
    default_constructors: [OnceCell<SourceProviderRef>; 2],
}

impl Host for Vm {
    fn private_name(&self, name: Text<'_>) -> Option<Identifier> {
        let names = self.services.code.builtins.embedder_names.borrow();
        names.get(&Atom::find(name)?.name()).cloned()
    }

    fn builtin_value(&self, name: PropertyName<'_>) -> Option<BuiltinValue> {
        self.services.code.builtins.values.get(name)
    }

    fn version(&self) -> u32 {
        self.services.code.builtins.values.version
    }
}

struct BuiltinValues {
    /// Of the symbol.
    by_address: FastHashMap<usize, BuiltinValue>,
    version: u32,
}

impl Default for BuiltinValues {
    fn default() -> BuiltinValues {
        let values = (RealmSlot::PRIVATE_NAMES.iter())
            .map(|&(name, slot)| (name, BuiltinValue::LinkTime(slot.as_constant())))
            .chain(BUILTIN_VALUES.iter().copied());
        let mut version = 0u64;
        let values = values.map(|(name, value)| {
            let bits = match value {
                BuiltinValue::Int32(number) => number as u64,
                BuiltinValue::Double(number) => number.to_bits(),
                BuiltinValue::LinkTime(constant) => 1 << 32 | u64::from(constant.0),
                BuiltinValue::CellTest(cell_type) => 2 << 32 | u64::from(cell_type.0),
                BuiltinValue::ShapeFlagsTest(flags) => 3 << 32 | u64::from(flags),
            };
            for word in [u64::from(name.hash()), bits] {
                version = (version.rotate_left(29) ^ word).wrapping_mul(0x9e37_79b9_7f4a_7c15);
            }
            (name.address(), value)
        });
        BuiltinValues {
            by_address: values.collect(),
            version: (version >> 32) as u32,
        }
    }
}

impl BuiltinValues {
    fn get(&self, name: PropertyName<'_>) -> Option<BuiltinValue> {
        self.by_address.get(&name.address()).copied()
    }
}

/// For code that is not run here. It has a symbol for any `@name`: the `Vm` that loads the code looks for its own.
#[derive(Default)]
pub struct DetachedHost {
    symbols: RefCell<FastHashMap<Identifier, Identifier>>,
    values: LazyCell<BuiltinValues>,
}

impl Host for DetachedHost {
    fn private_name(&self, name: Text<'_>) -> Option<Identifier> {
        let (name, mut symbols) = (Atom::new(name), self.symbols.borrow_mut());
        let symbol = (symbols.entry(name.clone().into()))
            .or_insert_with(|| SymbolRef::private(name.string()).into());
        Some(symbol.clone())
    }

    fn builtin_value(&self, name: PropertyName<'_>) -> Option<BuiltinValue> {
        self.values.get(name)
    }

    fn version(&self) -> u32 {
        self.values.version
    }
}

/// What can be told of `(function (..) { .. })` without parsing it. The offsets count from the first parenthesis.
#[derive(Clone, Copy, FieldOffsets)]
#[repr(C)]
pub struct BuiltinOutline {
    pub parameters_start: u32,
    pub length: u32,
    /// After the closing brace.
    pub end: u32,
    pub is_async: bool,
    pub is_generator: bool,
    pub is_strict: bool,
}

impl BuiltinOutline {
    /// No parameter has a default. Panics if the text is no such function.
    pub fn of(text: &[u8]) -> BuiltinOutline {
        let find = |byte, from: usize| {
            from + bun_highway::index_of_char(&text[from..], byte).expect("a function")
        };
        let parameters_start = find(b'(', 1);
        let (mut at, mut depth, mut length, mut is_in_parameter) =
            (parameters_start + 1, 0, 0, false);
        loop {
            match text[at] {
                b')' => break,
                b'/' => at = find(b'/', at + 1),
                b',' if depth == 0 => is_in_parameter = false,
                b'.' if !is_in_parameter => is_in_parameter = true,
                b' ' | b'\n' => {}
                byte => {
                    length += u32::from(!is_in_parameter);
                    is_in_parameter = true;
                    match byte {
                        b'{' | b'[' => depth += 1,
                        b'}' | b']' => depth -= 1,
                        _ => {}
                    }
                }
            }
            at += 1;
        }
        let body = text[find(b'{', at) + 1..].trim_ascii_start();
        let after_brace = text.iter().rev().take_while(|&&byte| byte != b'}').count();
        BuiltinOutline {
            parameters_start: parameters_start as u32,
            length,
            end: (text.len() - after_brace) as u32,
            is_async: text.starts_with(b"(async "),
            is_generator: text[..parameters_start].trim_ascii_end().ends_with(b"*"),
            is_strict: body
                .get(1..)
                .is_some_and(|it| it.starts_with(b"use strict")),
        }
    }
}

/// Errors and debuggers point into the source if it has a URL.
pub fn describe_builtin(
    source: &SourceCode,
    outline: &BuiltinOutline,
    name: Identifier,
    kind: FunctionKind,
    visibility: Visibility,
) -> FunctionRef {
    BuiltinFunction {
        name,
        range: source.start + 1..source.start + outline.end,
        parameters_start: source.start + outline.parameters_start,
        length: outline.length,
        kind,
        is_strict: outline.is_strict,
        is_async: outline.is_async,
        is_generator: outline.is_generator,
        // The frame is that of the body too, which only `PrivateRecursive` hides.
        visibility: match visibility {
            Visibility::Private if outline.is_async => Visibility::Public,
            _ => visibility,
        },
        has_positions: source.provider.url().is_some(),
    }
    .into_function()
}

/// A function that refers to nothing but globals, and its code.
#[derive(Clone)]
pub struct UnlinkedFunction {
    pub provider: SourceProviderRef,
    pub function: FunctionRef,
}

impl UnlinkedFunction {
    /// A new one, whose code is linked to the realm that calls it first.
    pub fn link(&self, vm: &Vm) -> Gc<FunctionExecutable> {
        FunctionExecutable::create(vm, self.provider.clone(), self.function.clone())
    }
}

/// One of the embedder, whose source has no URL.
pub struct StaticBuiltin {
    pub text: &'static [u8],
    pub outline: BuiltinOutline,
    pub name: &'static str,
    pub kind: FunctionKind,
    pub visibility: Visibility,
}

impl StaticBuiltin {
    fn describe(&self) -> UnlinkedFunction {
        let source = SourceCode::whole(static_provider(StringRef::from_static_units(self.text)));
        let name = Identifier::from_literal(self.name);
        UnlinkedFunction {
            function: describe_builtin(&source, &self.outline, name, self.kind, self.visibility),
            provider: source.provider,
        }
    }
}

fn static_provider(text: StringRef) -> SourceProviderRef {
    let provider = SourceProvider::build(text, None, SourceType::Program);
    provider.is_static(true).finish()
}

impl Vm {
    /// See `UnlinkedFunction::link`.
    pub fn link_static_builtin(&self, builtin: &StaticBuiltin) -> Gc<FunctionExecutable> {
        let functions = &self.services.code.builtins.embedder_functions;
        let function = (functions.borrow_mut().entry(builtin.text.as_ptr().addr()))
            .or_insert_with(|| builtin.describe())
            .clone();
        FunctionExecutable::create(self, function.provider, function.function)
    }

    pub(super) fn forget_static_builtins(&self) {
        self.services.code.builtins.embedder_functions.take();
    }

    /// Makes `@name` stand for `symbol`.
    pub fn register_private_name(&self, name: Atom, symbol: Identifier) {
        let mut names = self.services.code.builtins.embedder_names.borrow_mut();
        names.insert(name.into(), symbol);
    }

    fn builtin_function(&self, id: BuiltinId) -> (SourceProviderRef, FunctionRef) {
        let mut functions = self.services.code.builtins.functions.borrow_mut();
        let function = functions.entry(id.0).or_insert_with(|| {
            let builtin = (self.hooks().builtin_source)(id);
            let text = StringRef::from_literal(builtin.text);
            (static_provider(text), builtin.to_function())
        });
        function.clone()
    }

    pub(super) fn default_constructor_provider(
        &self,
        function: &FunctionInfo,
    ) -> SourceProviderRef {
        let index = usize::from(function.kind() == FunctionKind::DerivedConstructor);
        let provider = &self.services.code.builtins.default_constructors[index];
        let provider = provider.get_or_init(|| {
            let text = StringRef::from_literal(function.default_constructor_source());
            static_provider(text)
        });
        provider.clone()
    }

    /// A new one, whose code is linked to the realm that calls it first.
    pub fn builtin_executable(&self, id: BuiltinId) -> Gc<FunctionExecutable> {
        let (provider, function) = self.builtin_function(id);
        let executable = FunctionExecutable::create(self, provider, function);
        executable.set_intrinsic((self.hooks().builtin_source)(id).intrinsic);
        executable
    }
}

impl FunctionExecutable {
    pub fn is_for_builtin(&self, vm: &Vm, id: BuiltinId) -> bool {
        core::ptr::eq(
            &raw const *self.info(),
            &raw const *vm.builtin_function(id).1,
        )
    }
}
