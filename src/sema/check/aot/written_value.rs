use super::queries::Queries;
use crate::atom::Atom;
use crate::fold::slice_in;
use crate::hir::{ExprId, File};
use crate::hir_from_data::{DataModule, DataValue, module_from_data};
use crate::session::Arena;

/// What an expression of the program writes out, with the names in it replaced by what they hold.
#[derive(Clone, PartialEq, Debug)]
pub enum WrittenValue {
    Null,
    Boolean(bool),
    Number(f64),
    String(Atom),
    Array(Vec<WrittenValue>),
    /// In the order in which the object has its keys. No key is there twice.
    Object(Vec<(Atom, WrittenValue)>),
}

fn data_of<'s>(value: &WrittenValue, arena: &'s Arena) -> DataValue<'s> {
    match value {
        WrittenValue::Null => DataValue::Null,
        WrittenValue::Boolean(value) => DataValue::Boolean(*value),
        WrittenValue::Number(number) => DataValue::Number(*number),
        WrittenValue::String(text) => DataValue::String(*text),
        WrittenValue::Array(elements) => {
            let elements: Vec<DataValue<'s>> = elements
                .iter()
                .map(|element| data_of(element, arena))
                .collect();
            DataValue::Array(slice_in(&elements, arena))
        }
        WrittenValue::Object(properties) => {
            let properties: Vec<(Atom, DataValue<'s>)> = properties
                .iter()
                .map(|(key, value)| (*key, data_of(value, arena)))
                .collect();
            DataValue::Object(slice_in(&properties, arena))
        }
    }
}

impl<'s> Queries<'_, '_, 's> {
    /// The value as the literal of a file of its own, and that literal.
    pub fn tree_of_written_value(&self, value: &WrittenValue) -> (&'s File<'s>, ExprId) {
        let arena = self.c.arena;
        let default = &*arena.alloc(data_of(value, arena));
        let module = DataModule::Value {
            default,
            exports_keys: false,
        };
        let tree = module_from_data(&module, &self.c.p.files.atoms, arena);
        let literal = tree.host_values[0].0;
        (&*arena.alloc(tree.file), literal)
    }
}
