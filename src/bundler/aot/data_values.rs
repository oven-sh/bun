use std::borrow::Cow;

use bun_alloc::Arena;
use bun_aot::statistics::{LimitId, LimitValues};
use bun_ast::expr::Data;
use bun_ast::{E, Expr, G, Loc, Log, StoreRef};
use bun_core::strings::{is_valid_utf8, wtf8_to_utf16, wtf16_to_wtf8};
use bun_sema::atom::{Atom, Interner, number_to_string};
use bun_sema::hir_from_data::DataValue;
use bun_sema::session::{ArenaHashSet, map_in, set_in};

pub(crate) trait ValueSink {
    fn undefined(&mut self);
    fn null(&mut self);
    fn boolean(&mut self, value: bool);
    fn number(&mut self, value: f64);
    fn string(&mut self, text: &[u8]);
    fn big_int(&mut self, digits: &[u8]);
    fn temporal(&mut self, class: &[u8], text: &[u8]);
    fn array(&mut self, length: usize);
    fn key(&mut self, text: &[u8]);
    fn object(&mut self, length: usize);
}

#[derive(Debug)]
pub(crate) enum NotData {
    Expression,
    Cyclic,
    TooLarge,
}

const MAX_LINEAR_KEY_SEARCH: usize = 8;

type NodeAddress = Option<*const ()>;

#[derive(Copy, Clone)]
enum PropertyKey<'e> {
    String(&'e E::EString),
    Number(f64),
    Boolean(bool),
    Null,
}

enum Step<'e> {
    Expr(&'e Expr),
    Hole,
    Json(E::JsonValue),
    Key(PropertyKey<'e>),
    JsonKey(E::Str),
    EndArray(usize, NodeAddress),
    EndObject(usize, NodeAddress),
}

impl Step<'_> {
    fn is_value(&self) -> bool {
        match self {
            Step::Expr(_) | Step::Hole | Step::Json(_) => true,
            Step::Key(_) | Step::JsonKey(_) | Step::EndArray(..) | Step::EndObject(..) => false,
        }
    }
}

struct ExprWriter<'e, 'a, S> {
    stack: Vec<Step<'e>>,
    open_nodes: ArenaHashSet<'a, *const ()>,
    scratch: &'a Arena,
    sink: &'a mut S,
}

fn max_data_nodes() -> usize {
    LimitValues::for_host().get(LimitId::MaxDataNodes) as usize
}

pub(crate) fn write_expr(
    root: &Expr,
    scratch: &Arena,
    sink: &mut impl ValueSink,
) -> Result<(), NotData> {
    let mut writer = ExprWriter {
        stack: vec![Step::Expr(root)],
        open_nodes: set_in(scratch),
        scratch,
        sink,
    };
    let max_value_count = max_data_nodes();
    let mut value_count = 0;
    while let Some(step) = writer.stack.pop() {
        if step.is_value() {
            value_count += 1;
            if value_count > max_value_count {
                return Err(NotData::TooLarge);
            }
        }
        writer.run_step(step)?;
    }
    Ok(())
}

impl<'e, S: ValueSink> ExprWriter<'e, '_, S> {
    #[allow(clippy::needless_pass_by_value)] // popped off the stack of steps
    fn run_step(&mut self, step: Step<'e>) -> Result<(), NotData> {
        match step {
            Step::Expr(expr) => return self.write_value(expr),
            Step::Hole => self.sink.undefined(),
            Step::Json(value) => self.write_json(value),
            Step::Key(key) => {
                let text = property_key_text(key, self.scratch)?;
                self.sink.key(&text);
            }
            Step::JsonKey(text) => self.sink.key(&to_canonical_wtf8(text.slice())),
            Step::EndArray(length, address) => {
                self.leave_node(address);
                self.sink.array(length);
            }
            Step::EndObject(length, address) => {
                self.leave_node(address);
                self.sink.object(length);
            }
        }
        Ok(())
    }

    fn write_value(&mut self, expr: &'e Expr) -> Result<(), NotData> {
        match &expr.data {
            Data::EUndefined(_) => self.sink.undefined(),
            Data::ENull(_) => self.sink.null(),
            Data::EBoolean(boolean) | Data::EBranchBoolean(boolean) => {
                self.sink.boolean(boolean.value);
            }
            Data::ENumber(number) => self.sink.number(number.value()),
            Data::EString(text) => match text.get().toml_datetime {
                Some(kind) => {
                    let text = text.get().slice8();
                    self.sink.temporal(kind.temporal_class(), text);
                }
                None => {
                    let text = string_text(text.get(), self.scratch)?;
                    self.sink.string(&text);
                }
            },
            Data::EBigInt(big_int) => {
                let digits = big_int.get().value.slice();
                if !digits.iter().all(u8::is_ascii_digit) {
                    return Err(NotData::Expression);
                }
                self.sink.big_int(digits);
            }
            Data::EInlinedEnum(inlined) => self.stack.push(Step::Expr(&inlined.get().value)),
            Data::EArray(array) => return self.open_array(array),
            Data::EObject(object) => return self.open_object(object),
            Data::EObjectJSON(object) => {
                check_tape_encoding(object.get().tape())?;
                self.open_json_object(*object);
            }
            Data::EArrayJSON(array) => {
                check_tape_encoding(array.get().tape())?;
                self.open_json_array(*array);
            }
            _ => return Err(NotData::Expression),
        }
        Ok(())
    }

    fn write_json(&mut self, value: E::JsonValue) {
        match value {
            E::JsonValue::Null => self.sink.null(),
            E::JsonValue::Boolean(value) => self.sink.boolean(value),
            E::JsonValue::Number(number) => self.sink.number(number.value()),
            E::JsonValue::String(text) => self.sink.string(&to_canonical_wtf8(text.slice())),
            E::JsonValue::Object(object) => self.open_json_object(object),
            E::JsonValue::Array(array) => self.open_json_array(array),
        }
    }

    fn open_array(&mut self, array: &'e StoreRef<E::Array>) -> Result<(), NotData> {
        let address = self.enter_node(array.as_ptr().cast_const().cast())?;
        let items = &array.get().items;
        self.stack.push(Step::EndArray(items.len(), address));
        for item in items.iter().rev() {
            self.stack.push(match item.data {
                Data::EMissing(_) => Step::Hole,
                _ => Step::Expr(item),
            });
        }
        Ok(())
    }

    fn open_object(&mut self, object: &'e StoreRef<E::Object>) -> Result<(), NotData> {
        let address = self.enter_node(object.as_ptr().cast_const().cast())?;
        let properties = &object.get().properties;
        self.stack.push(Step::EndObject(properties.len(), address));
        for property in properties.iter().rev() {
            let (Some(key), Some(value)) = (&property.key, &property.value) else {
                return Err(NotData::Expression);
            };
            if property.kind != G::PropertyKind::Normal || property.initializer.is_some() {
                return Err(NotData::Expression);
            }
            self.stack.push(Step::Key(property_key(key)?));
            self.stack.push(Step::Expr(value));
        }
        Ok(())
    }

    fn open_json_object(&mut self, object: StoreRef<E::ObjectJSON>) {
        let properties = object.get().properties();
        self.stack.push(Step::EndObject(properties.len(), None));
        for property in properties.iter().rev() {
            self.stack.push(Step::JsonKey(property.key));
            self.stack.push(Step::Json(property.value));
        }
    }

    fn open_json_array(&mut self, array: StoreRef<E::ArrayJSON>) {
        let items = array.get().items();
        self.stack.push(Step::EndArray(items.len(), None));
        self.stack
            .extend(items.iter().rev().map(|item| Step::Json(*item)));
    }

    fn enter_node(&mut self, address: *const ()) -> Result<NodeAddress, NotData> {
        match self.open_nodes.insert(address) {
            true => Ok(Some(address)),
            false => Err(NotData::Cyclic),
        }
    }

    fn leave_node(&mut self, address: NodeAddress) {
        if let Some(address) = address {
            self.open_nodes.remove(&address);
        }
    }
}

fn check_tape_encoding(tape: &E::JsonTape) -> Result<(), NotData> {
    match tape.encoding {
        E::StrEncoding::Utf8 => Ok(()),
        E::StrEncoding::Latin1 | E::StrEncoding::Utf16 => Err(NotData::Expression),
    }
}

fn property_key(key: &Expr) -> Result<PropertyKey<'_>, NotData> {
    match &key.data {
        Data::EString(text) => Ok(PropertyKey::String(text.get())),
        Data::ENumber(number) => Ok(PropertyKey::Number(number.value())),
        Data::EBoolean(boolean) | Data::EBranchBoolean(boolean) => {
            Ok(PropertyKey::Boolean(boolean.value))
        }
        Data::ENull(_) => Ok(PropertyKey::Null),
        _ => Err(NotData::Expression),
    }
}

fn property_key_text<'t>(
    key: PropertyKey<'t>,
    scratch: &'t Arena,
) -> Result<Cow<'t, [u8]>, NotData> {
    let keyword: &[u8] = match key {
        PropertyKey::String(text) => return string_text(text, scratch),
        PropertyKey::Number(value) => return Ok(Cow::Owned(number_to_string(value))),
        PropertyKey::Boolean(true) => b"true",
        PropertyKey::Boolean(false) => b"false",
        PropertyKey::Null => b"null",
    };
    Ok(Cow::Borrowed(keyword))
}

fn string_text<'t>(string: &'t E::EString, scratch: &'t Arena) -> Result<Cow<'t, [u8]>, NotData> {
    if string.is_utf16 {
        return Ok(Cow::Owned(wtf16_to_wtf8(string.slice16())));
    }
    Ok(to_canonical_wtf8(string.flattened(scratch).data.slice()))
}

fn to_canonical_wtf8(text: &[u8]) -> Cow<'_, [u8]> {
    if is_valid_utf8(text) {
        return Cow::Borrowed(text);
    }
    Cow::Owned(wtf16_to_wtf8(&wtf8_to_utf16(text)))
}

#[allow(clippy::needless_pass_by_value)] // the end of the error
pub(crate) fn report_not_data(log: &mut Log, path: &[u8], subject: &str, error: NotData) {
    let path = bstr::BStr::new(path);
    match error {
        NotData::Expression => log.add_error_fmt(
            None,
            Loc::EMPTY,
            format_args!("{subject} of \"{path}\" is not a plain value"),
        ),
        NotData::Cyclic => log.add_error_fmt(
            None,
            Loc::EMPTY,
            format_args!("{subject} of \"{path}\" contains a circular reference"),
        ),
        NotData::TooLarge => log.add_error_fmt(
            None,
            Loc::EMPTY,
            format_args!(
                "{subject} of \"{path}\" has more than {} values ({})",
                max_data_nodes(),
                LimitId::MaxDataNodes.name(),
            ),
        ),
    }
}

pub(crate) struct DataValueBuilder<'i, 's> {
    arena: &'s Arena,
    atoms: &'i Interner<'s>,
    values: Vec<DataValue<'s>>,
    keys: Vec<Atom>,
}

impl<'i, 's> DataValueBuilder<'i, 's> {
    pub(crate) fn new(arena: &'s Arena, atoms: &'i Interner<'s>) -> Self {
        DataValueBuilder {
            arena,
            atoms,
            values: Vec::new(),
            keys: Vec::new(),
        }
    }

    pub(crate) fn finish(self) -> &'s DataValue<'s> {
        let [value] = self.values[..] else {
            panic!("a finished sink holds one value, not {}", self.values.len());
        };
        self.arena.alloc(value)
    }

    fn merge_properties(
        &self,
        keys: &[Atom],
        values: &[DataValue<'s>],
    ) -> Vec<(Atom, DataValue<'s>)> {
        let mut properties: Vec<(Atom, DataValue<'s>)> = Vec::with_capacity(keys.len());
        let pairs = keys.iter().copied().zip(values.iter().copied());
        if keys.len() <= MAX_LINEAR_KEY_SEARCH {
            for (key, value) in pairs {
                match properties.iter_mut().find(|property| property.0 == key) {
                    Some(property) => property.1 = value,
                    None => properties.push((key, value)),
                }
            }
            return properties;
        }
        let mut positions = map_in::<Atom, usize>(self.arena);
        for (key, value) in pairs {
            match positions.get(&key) {
                Some(&position) => properties[position].1 = value,
                None => {
                    positions.insert(key, properties.len());
                    properties.push((key, value));
                }
            }
        }
        properties
    }
}

impl ValueSink for DataValueBuilder<'_, '_> {
    fn undefined(&mut self) {
        self.values.push(DataValue::Undefined);
    }

    fn null(&mut self) {
        self.values.push(DataValue::Null);
    }

    fn boolean(&mut self, value: bool) {
        self.values.push(DataValue::Boolean(value));
    }

    fn number(&mut self, value: f64) {
        self.values.push(DataValue::Number(value));
    }

    fn string(&mut self, text: &[u8]) {
        self.values.push(DataValue::String(self.atoms.intern(text)));
    }

    fn big_int(&mut self, digits: &[u8]) {
        self.values
            .push(DataValue::BigInt(self.atoms.intern(digits)));
    }

    fn temporal(&mut self, class: &[u8], text: &[u8]) {
        self.values.push(DataValue::Temporal {
            class: self.atoms.intern(class),
            text: self.atoms.intern(text),
        });
    }

    fn array(&mut self, length: usize) {
        let start = self.values.len() - length;
        let items = self.arena.alloc_slice_copy(&self.values[start..]);
        self.values.truncate(start);
        self.values.push(DataValue::Array(items));
    }

    fn key(&mut self, text: &[u8]) {
        self.keys.push(self.atoms.intern(text));
    }

    fn object(&mut self, length: usize) {
        let value_start = self.values.len() - length;
        let key_start = self.keys.len() - length;
        let merged = self.merge_properties(&self.keys[key_start..], &self.values[value_start..]);
        let properties = self.arena.alloc_slice_copy(&merged);
        self.values.truncate(value_start);
        self.keys.truncate(key_start);
        self.values.push(DataValue::Object(properties));
    }
}

pub(crate) fn data_value_from_expr<'s>(
    root: &Expr,
    scratch: &Arena,
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> Result<&'s DataValue<'s>, NotData> {
    let mut builder = DataValueBuilder::new(arena, atoms);
    write_expr(root, scratch, &mut builder)?;
    Ok(builder.finish())
}

#[cfg(test)]
mod tests;
