use core::cell::{Cell, RefCell};

use bun_alloc::AllocError;
use bun_engine_macros::cell;
use bun_engine_text::{PropertyName, StringImpl, StringRef, SymbolRef, Text};

use crate::heap::{Scope, Survivors};
use crate::{Cx, Field, Gc, JsCell, JsResult, JsString, TypeFlags, Value, Visitor, Vm};

/// The per-cell bit says that it is among the `WeaklyHeldSymbols`.
#[cell(name = "symbol", cell_type = Symbol, flags = TypeFlags::SHAPE_IS_IMMORTAL,
    export = "engine_class_Symbol")]
pub struct JsSymbol {
    base: JsCell,
    symbol: SymbolRef,
    pub(self) cached_description: Field<Option<Gc<JsString>>>,
    pub(self) cached_string: Field<Option<Gc<JsString>>>,
}

impl JsSymbol {
    /// The `StringImpl` that is the property key. Never changes.
    pub const OFFSET_OF_NAME: usize = core::mem::offset_of!(JsSymbol, symbol);
    /// A string, or zero if it has not been asked for or there is none. Once set it stays.
    pub const OFFSET_OF_DESCRIPTION: usize = core::mem::offset_of!(JsSymbol, cached_description);
    /// What `toString` returns, which is no rope, or zero until it has been called. Once set it stays.
    pub const OFFSET_OF_STRING: usize = core::mem::offset_of!(JsSymbol, cached_string);

    /// No cell stands for the symbol yet.
    fn allocate(vm: &Vm, symbol: SymbolRef, description: Option<Gc<JsString>>) -> Gc<JsSymbol> {
        let address = symbol.name().address();
        let cell = vm.allocate::<JsSymbol>(JsSymbolInit {
            base: vm.shapes.symbol(),
            symbol,
            cached_description: description,
            cached_string: None,
        });
        vm.symbols.insert(address, cell);
        cell
    }

    /// The one cell that stands for the symbol.
    pub fn for_symbol(vm: &Vm, symbol: SymbolRef) -> Gc<JsSymbol> {
        (vm.symbols.get(vm, &symbol.name().address()))
            .unwrap_or_else(|| Self::allocate(vm, symbol, None))
    }

    pub fn create(vm: &Vm, description: Option<&StringImpl>) -> Gc<JsSymbol> {
        let symbol = description.map_or_else(SymbolRef::without_description, SymbolRef::new);
        Self::allocate(vm, symbol, None)
    }

    pub fn with_description(cx: &Cx, description: Gc<JsString>) -> JsResult<Gc<JsSymbol>> {
        let symbol = SymbolRef::new(&*description.resolve(cx)?);
        Ok(Self::allocate(cx, symbol, Some(description)))
    }

    pub fn create_private(vm: &Vm, description: &StringImpl) -> Gc<JsSymbol> {
        Self::allocate(vm, SymbolRef::private(description), None)
    }

    #[inline(always)]
    pub fn name(&self) -> PropertyName<'_> {
        self.symbol.name()
    }

    pub fn symbol(&self) -> &SymbolRef {
        &self.symbol
    }

    pub fn description(&self, vm: &Vm) -> Option<Gc<JsString>> {
        if self.cached_description().is_none() {
            let description = self.symbol.description_string()?;
            self.set_cached_description(Some(JsString::new(vm, description)));
        }
        self.cached_description()
    }

    /// SymbolDescriptiveString
    pub fn descriptive_string(&self) -> Result<StringRef, AllocError> {
        let (open, close) = (Text::from_ascii("Symbol("), Text::from_ascii(")"));
        StringRef::try_concat(&[open, self.name().text(), close])
    }

    /// The same, as a value.
    pub fn to_descriptive_string(&self, cx: &Cx) -> JsResult<Gc<JsString>> {
        if let Some(string) = self.cached_string() {
            return Ok(string);
        }
        let string = JsString::new(cx, cx.or_out_of_memory(self.descriptive_string())?);
        self.set_cached_string(Some(string));
        Ok(string)
    }
}

/// The cells of symbols that something refers to weakly. A script can get a symbol back from an object that has it
/// for a key, so such a cell lives as long as its name has another holder.
#[derive(Default)]
pub(crate) struct WeaklyHeldSymbols {
    cells: RefCell<Vec<usize>>,
    first_young: Cell<usize>,
}

impl WeaklyHeldSymbols {
    fn first_at_stake(&self, scope: Scope) -> usize {
        match scope {
            Scope::Eden => self.first_young.get(),
            Scope::Full => 0,
        }
    }

    pub(crate) fn visit(&self, visitor: &mut Visitor) {
        for &address in &self.cells.borrow()[self.first_at_stake(visitor.scope())..] {
            // SAFETY: pruned before it is freed.
            let symbol = unsafe { Gc::<JsSymbol>::from_address(address) };
            if !symbol.name().string().has_one_ref() {
                visitor.append(symbol);
            }
        }
    }

    pub(crate) fn prune(&self, survivors: &Survivors) {
        let mut cells = self.cells.borrow_mut();
        // SAFETY: only the address is looked at.
        let is_dead =
            |&mut it: &mut usize| !survivors.contains(unsafe { Gc::<JsSymbol>::from_address(it) });
        (cells.extract_if(self.first_at_stake(survivors.scope()).., is_dead)).for_each(drop);
        self.first_young.set(cells.len());
    }
}

impl Value {
    /// The string or symbol that a script sees for a key.
    #[inline]
    pub fn from_name(vm: &Vm, name: PropertyName<'_>) -> Value {
        match name.to_symbol() {
            Some(symbol) => JsSymbol::for_symbol(vm, symbol).into(),
            None => JsString::from_name(vm, name).into(),
        }
    }

    /// What `String(value)` returns.
    #[inline]
    pub fn to_string_or_description(self, cx: &mut Cx) -> JsResult<Gc<JsString>> {
        match self.as_symbol() {
            Some(symbol) => symbol.to_descriptive_string(cx),
            None => self.to_string(cx),
        }
    }
}

impl JsCell {
    /// Before a reference that a script can follow, and that does not keep the cell alive, is stored.
    #[inline(always)]
    pub(crate) fn will_be_held_weakly(&self) {
        if self.is_symbol() && !self.per_cell_bit() {
            self.add_to_weakly_held_symbols();
        }
    }

    #[cold]
    #[inline(never)]
    fn add_to_weakly_held_symbols(&self) {
        self.set_per_cell_bit(true);
        let symbols = &self.heap().vm().weakly_held_symbols;
        symbols.cells.borrow_mut().push(self.address());
    }
}
