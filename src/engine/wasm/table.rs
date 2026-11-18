//! `WebAssembly.Table`

use std::rc::Rc;

use bun_engine_vm::{GcFree, JsDestructibleObject, Visitor, errors as vm_errors};
use bun_engine_wasm_format::limits::MAX_TABLE_ENTRIES;
use bun_engine_wasm_format::{
    AbstractHeapType, CanonicalValType, HeapType, Limits, RefType, ValType,
};
use bun_engine_wasm_runtime::{Reference, Table, TableType};

use crate::descriptor::{Descriptor, from_address, to_address};
use crate::namespace::{Namespace, Slot, define_type_method, shape_for_new_target};
use crate::owned::{host_cell, visit_with};
use crate::prelude::*;
use crate::store::store;
use crate::{reflection, values};

static_table!(static PROTOTYPE_PROPERTIES = [
    read_only_attribute(names::length, length),
    member(StaticProperty::function(names::grow, grow, 1)),
    member(StaticProperty::function(names::get, get, 1)),
    member(StaticProperty::function(names::set, set, 1)),
    StaticProperty::position_of(names::r#type),
    StaticProperty::position_of(names::constructor),
    StaticProperty::string(symbols::toStringTag, names::wasmTable),
]);

define_object!(Prototype, "WebAssembly.Table", PROTOTYPE_PROPERTIES);

struct Elements(Rc<Table>);

// SAFETY: the cell that has this visits them.
unsafe impl GcFree for Elements {}

#[cell(name = "WebAssembly.Table", visit_children)]
pub(crate) struct WasmTable {
    base: JsDestructibleObject,
    table: Elements,
}

impl WasmTable {
    pub(crate) fn of(table: &Table) -> Gc<WasmTable> {
        let owner = table.owner().expect("an owner");
        // SAFETY: `create` makes every owner, and instances keep those of their tables.
        unsafe { Gc::from_address(owner.address()) }
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        if visitor.puts_off_current_cell() {
            return;
        }
        self.table.0.trace(visit_with(visitor));
        visitor.report_extra_memory(self.table.0.size_in_bytes());
    }

    pub(crate) fn table(&self) -> &Rc<Table> {
        &self.table.0
    }

    fn element(&self) -> RefType {
        let element = self.table.0.ty().element.erased();
        element.as_ref().expect("a reference")
    }

    fn holds_exceptions(&self) -> bool {
        self.element().heap_type().is(AbstractHeapType::Exn)
    }
}

/// For a new table.
pub(crate) fn create(cx: &Cx, shape: Gc<Shape>, table: &Rc<Table>) -> Gc<WasmTable> {
    let object = cx.allocate::<WasmTable>(WasmTableInit {
        base: JsObjectInit::new(cx, shape),
        table: Elements(Rc::clone(table)),
    });
    // SAFETY: the object keeps and traces the table. Whoever made the table fills it.
    unsafe { table.set_owner(host_cell(object.cell())) };
    (cx.heap).report_extra_memory_allocated(&object, table.size_in_bytes());
    object
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let prototype = Prototype::create(cx, cx.object_prototype().into());
    define_type_method(cx, &prototype, reflect);
    let spec = ShapeSpec::of::<WasmTable>();
    let shape = Shape::create(cx, Some(cx.global()), prototype.into(), spec);
    namespace.put(Slot::TableShape, shape);
    let constructor = new_constructor(cx, call, construct, 1, names::Table, &prototype);
    namespace.put(Slot::TableConstructor, constructor);
}

fn read_type(cx: &mut Cx, descriptor: &Descriptor) -> JsResult<TableType> {
    let address = descriptor.address_type(cx)?;
    let kinds = [
        (names::funcref, ValType::FUNCREF),
        (names::anyfunc, ValType::FUNCREF),
        (names::externref, ValType::EXTERNREF),
    ];
    let Some(element) = descriptor.choice(cx, names::element, &kinds)? else {
        return Err(cx.throw_type_error(
            "WebAssembly.Table expects its 'element' field to be the string 'funcref' or 'externref'",
        ));
    };
    let initial = descriptor.initial(cx, address)?;
    if initial > MAX_TABLE_ENTRIES.into() {
        return Err(cx.throw_range_error(format_args!(
            "WebAssembly.Table 'initial' value is above the upper bound {MAX_TABLE_ENTRIES}"
        )));
    }
    let maximum = descriptor.maximum(cx, address)?;
    if maximum.is_some_and(|it| it < initial) {
        let message = "'maximum' property must be greater than or equal to the 'initial' property";
        return Err(cx.throw_range_error(message));
    }
    Ok(TableType {
        element: CanonicalValType::plain(element),
        address,
        limits: Limits { initial, maximum },
    })
}

/// DefaultValue, for an argument that is missing.
fn default_value(element: RefType) -> Value {
    match element.heap_type().is(AbstractHeapType::Extern) {
        true => Value::UNDEFINED,
        false => Value::NULL,
    }
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(vm_errors::throw_called_without_new(cx, "WebAssembly.Table"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let shape = shape_for_new_target(cx, frame, Slot::TableShape)?;
    let descriptor = Descriptor::new(cx, "WebAssembly.Table", frame.argument(0))?;
    let ty = read_type(cx, &descriptor)?;
    let Some(table) = store(cx).and_then(|store| Table::new(&store, ty).ok()) else {
        return Err(cx.throw_range_error("couldn't create Table"));
    };
    let object = create(cx, shape, &table);
    let value = match frame.argument_count() {
        ..2 => default_value(object.element()),
        _ => frame.argument(1),
    };
    let Some(value) = values::try_to_reference(value, (&table.ty().element).into()) else {
        return Err(cx.throw_type_error(
            "WebAssembly.Table.prototype.constructor expects the second argument to be null or an instance of WebAssembly.Function",
        ));
    };
    if !value.is_null() {
        // SAFETY: it has just been checked.
        unsafe { table.fill(0, value, table.len().into()) }.expect("in bounds");
    }
    Ok(object.into())
}

fn this_table(cx: &Cx, this: Value) -> JsResult<Gc<WasmTable>> {
    this.downcast().ok_or_else(|| {
        cx.throw_type_error("expected |this| value to be an instance of WebAssembly.Table")
    })
}

/// The second argument, or what stands for it.
fn value_argument(cx: &Cx, frame: &CallFrame, this: &WasmTable, method: &str) -> JsResult<Value> {
    if frame.argument_count() >= 2 {
        return Ok(frame.argument(1));
    }
    if this.element().is_nullable() {
        return Ok(default_value(this.element()));
    }
    Err(cx.throw_type_error(format_args!(
        "WebAssembly.Table.prototype.{method} requires the second argument for non-defaultable table type"
    )))
}

fn index_argument(cx: &mut Cx, frame: &CallFrame, table: &Table, method: &str) -> JsResult<u64> {
    let index = to_address(cx, frame.argument(0), table.ty().address)?;
    if index < table.len().into() {
        return Ok(index);
    }
    Err(cx.throw_range_error(format_args!(
        "WebAssembly.Table.prototype.{method} expects an integer less than the length of the table"
    )))
}

#[native_abi]
fn length(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let this = this_table(cx, this)?;
    let (length, address) = (this.table().len(), this.table().ty().address);
    Ok(from_address(cx, length.into(), address))
}

#[native_abi]
fn get(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_table(cx, frame.this_value())?;
    let table = this.anchor().table();
    let index = index_argument(cx, frame, table, "get")?;
    if this.holds_exceptions() {
        return Err(cx.throw_type_error("Table.get cannot handle exnref table"));
    }
    match table.get(index) {
        Ok(reference) => Ok(values::from_reference(reference)),
        Err(_) => Err(cx.throw_out_of_memory()),
    }
}

#[native_abi]
fn set(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_table(cx, frame.this_value())?;
    let table = this.anchor().table();
    let index = index_argument(cx, frame, table, "set")?;
    let value = value_argument(cx, frame, &this, "set")?;
    if this.holds_exceptions() {
        return Err(cx.throw_type_error("Table.set cannot handle exnref table"));
    }
    let value = values::to_reference(cx, value, (&table.ty().element).into())?;
    // SAFETY: it has just been checked.
    unsafe { table.fill(index, value, 1) }.expect("tables do not shrink");
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn grow(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_table(cx, frame.this_value())?;
    let table = this.anchor().table();
    let delta = to_address(cx, frame.argument(0), table.ty().address)?;
    let value = value_argument(cx, frame, &this, "grow")?;
    let value = match this.holds_exceptions() {
        false => values::to_reference(cx, value, (&table.ty().element).into())?,
        true if value.is_null() => Reference::NULL,
        true => return Err(cx.throw_type_error("Table.grow cannot handle exnref table")),
    };
    // SAFETY: it has just been checked.
    match unsafe { table.grow(delta, value) } {
        Some(length) => Ok(from_address(cx, length.into(), table.ty().address)),
        None => {
            Err(cx.throw_range_error("WebAssembly.Table.prototype.grow could not grow the table"))
        }
    }
}

#[native_abi]
fn reflect(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_table(cx, frame.this_value())?;
    let (table, element) = (this.anchor().table(), this.element());
    let ty = table.ty();
    let limits = Limits {
        initial: table.len().into(),
        ..ty.limits
    };
    let element = match element.heap_type().abstract_type().top() {
        AbstractHeapType::Func => RefType::new(HeapType::FUNC, element.is_nullable()),
        _ => element,
    };
    match reflection::table_type(cx, limits, ty.address, element.into()) {
        Some(object) => Ok(object.into()),
        None => Err(cx.throw_type_error(
            "WebAssembly.Table.prototype.type unable to produce type descriptor for the given table",
        )),
    }
}
