//! [`JsonView`]: the read accessors of [`Expr`] over a borrowed [`E::JsonValue`] or [`Expr`], without allocating.

use bun_alloc::Arena;

use crate::expr::{Data, Tag};
use crate::{E, Expr, G, Loc};

#[derive(Clone, Copy)]
pub struct JsonView<'t> {
    /// For an [`E::JsonValue`], the `key_loc` of its property or the `loc` of its array.
    pub loc: Loc,
    value: Value<'t>,
}

#[derive(Clone, Copy)]
enum Value<'t> {
    JsonValue(&'t E::JsonValue),
    Expr(&'t Expr),
}

#[derive(Clone, Copy)]
pub struct Query<'t> {
    pub value: JsonView<'t>,
    pub loc: Loc,
}

impl<'t> From<&'t Expr> for JsonView<'t> {
    fn from(expr: &'t Expr) -> Self {
        JsonView {
            loc: expr.loc,
            value: Value::Expr(expr),
        }
    }
}

impl<'t> JsonView<'t> {
    pub fn from_json_value(value: &'t E::JsonValue, loc: Loc) -> Self {
        JsonView {
            loc,
            value: Value::JsonValue(value),
        }
    }

    pub fn as_json_value(self) -> Option<&'t E::JsonValue> {
        match self.value {
            Value::JsonValue(value) => Some(value),
            Value::Expr(_) => None,
        }
    }

    fn as_expr_data(self) -> Option<&'t Data> {
        match self.value {
            Value::JsonValue(_) => None,
            Value::Expr(expr) => Some(&expr.data),
        }
    }

    pub fn as_e_object_json(self) -> Option<&'t E::ObjectJSON> {
        match self.value {
            Value::JsonValue(value) => value.as_object(),
            Value::Expr(Expr {
                data: Data::EObjectJSON(object),
                ..
            }) => Some(object),
            Value::Expr(_) => None,
        }
    }

    pub fn as_e_array_json(self) -> Option<&'t E::ArrayJSON> {
        match self.value {
            Value::JsonValue(value) => value.as_array(),
            Value::Expr(Expr {
                data: Data::EArrayJSON(array),
                ..
            }) => Some(array),
            Value::Expr(_) => None,
        }
    }

    pub fn as_e_object(self) -> Option<&'t E::Object> {
        match self.as_expr_data()? {
            Data::EObject(object) => Some(object),
            _ => None,
        }
    }

    pub fn as_e_array(self) -> Option<&'t E::Array> {
        match self.as_expr_data()? {
            Data::EArray(array) => Some(array),
            _ => None,
        }
    }

    pub fn is_object(self) -> bool {
        match self.value {
            Value::JsonValue(value) => matches!(value, E::JsonValue::Object(_)),
            Value::Expr(expr) => matches!(expr.data, Data::EObject(_) | Data::EObjectJSON(_)),
        }
    }

    pub fn is_array(self) -> bool {
        match self.value {
            Value::JsonValue(value) => matches!(value, E::JsonValue::Array(_)),
            Value::Expr(expr) => matches!(expr.data, Data::EArray(_) | Data::EArrayJSON(_)),
        }
    }

    pub fn is_string(self) -> bool {
        match self.value {
            Value::JsonValue(value) => matches!(value, E::JsonValue::String(_)),
            Value::Expr(expr) => expr.is_string(),
        }
    }

    pub fn is_null(self) -> bool {
        match self.value {
            Value::JsonValue(value) => matches!(value, E::JsonValue::Null),
            Value::Expr(expr) => matches!(expr.data, Data::ENull(_)),
        }
    }

    pub fn tag_name(self) -> &'static str {
        let tag = match self.value {
            Value::JsonValue(E::JsonValue::Null) => Tag::ENull,
            Value::JsonValue(E::JsonValue::Boolean(_)) => Tag::EBoolean,
            Value::JsonValue(E::JsonValue::Number(_)) => Tag::ENumber,
            Value::JsonValue(E::JsonValue::String(_)) => Tag::EString,
            Value::JsonValue(E::JsonValue::Object(_)) => Tag::EObjectJSON,
            Value::JsonValue(E::JsonValue::Array(_)) => Tag::EArrayJSON,
            Value::Expr(expr) => expr.data.tag(),
        };
        tag.type_name()
    }

    pub fn as_bool(self) -> Option<bool> {
        match self.value {
            Value::JsonValue(E::JsonValue::Boolean(value)) => Some(*value),
            Value::JsonValue(_) => None,
            Value::Expr(expr) => expr.as_bool(),
        }
    }

    pub fn as_number(self) -> Option<f64> {
        match self.value {
            Value::JsonValue(E::JsonValue::Number(number)) => Some(number.value()),
            Value::JsonValue(_) => None,
            Value::Expr(expr) => expr.as_number(),
        }
    }

    pub fn as_utf8_string_literal(self) -> Option<&'t [u8]> {
        match self.value {
            Value::JsonValue(value) => value.as_str(),
            Value::Expr(expr) => expr.as_utf8_string_literal(),
        }
    }

    pub fn as_string<'b>(self, bump: &'b Arena) -> Option<&'b [u8]>
    where
        't: 'b,
    {
        match self.value {
            Value::JsonValue(value) => value.as_str(),
            Value::Expr(expr) => expr.as_string(bump),
        }
    }

    pub fn property_count(self) -> usize {
        match self.as_e_object_json() {
            Some(object) => object.properties().len(),
            None => self
                .as_e_object()
                .map_or(0, |object| object.properties.len()),
        }
    }

    pub fn as_property(self, name: &[u8]) -> Option<Query<'t>> {
        if let Some(object) = self.as_e_object_json() {
            let row = object
                .properties()
                .iter()
                .find(|row| row.key.slice() == name)?;
            return Some(Query {
                value: JsonView::from_json_value(&row.value, row.key_loc),
                loc: row.key_loc,
            });
        }
        let (_, key, value) = self.as_e_object()?.find_property(name)?;
        Some(Query {
            value: JsonView::from(value),
            loc: key.loc,
        })
    }

    pub fn get(self, name: &[u8]) -> Option<JsonView<'t>> {
        self.as_property(name).map(|query| query.value)
    }

    pub fn get_object(self, name: &[u8]) -> Option<JsonView<'t>> {
        self.get(name).filter(|value| value.is_object())
    }

    /// `(key, key_loc, value)` in source order. Empty if `self` is not an object.
    fn properties(self) -> impl Iterator<Item = (&'t [u8], Loc, JsonView<'t>)> {
        let rows = self
            .as_e_object_json()
            .map_or(&[][..], E::ObjectJSON::properties);
        let exprs: &[G::Property] = self.as_e_object().map_or(&[], |object| &object.properties);
        let rows = rows.iter().map(|row| {
            (
                row.key.slice(),
                row.key_loc,
                JsonView::from_json_value(&row.value, row.key_loc),
            )
        });
        let exprs = exprs.iter().filter_map(|property| {
            let key = property.key.as_ref()?;
            let value = property.value.as_ref()?;
            Some((
                key.as_utf8_string_literal()?,
                key.loc,
                JsonView::from(value),
            ))
        });
        rows.chain(exprs)
    }

    pub fn for_each_property(self, mut f: impl FnMut(&'t [u8], Loc, JsonView<'t>)) {
        self.properties()
            .for_each(|(key, loc, value)| f(key, loc, value));
    }

    pub fn try_for_each_property<Error>(
        self,
        mut f: impl FnMut(&'t [u8], Loc, JsonView<'t>) -> Result<(), Error>,
    ) -> Result<(), Error> {
        self.properties()
            .try_for_each(|(key, loc, value)| f(key, loc, value))
    }

    /// `None` for an empty array, like [`Expr::as_array`].
    pub fn as_array(self) -> Option<impl Iterator<Item = JsonView<'t>>> {
        let rows = self.as_e_array_json().map_or(&[][..], E::ArrayJSON::items);
        let exprs: &[Expr] = self.as_e_array().map_or(&[], |array| &array.items);
        let items = (rows
            .iter()
            .map(move |row| JsonView::from_json_value(row, self.loc)))
        .chain(exprs.iter().map(JsonView::from));
        (!rows.is_empty() || !exprs.is_empty()).then_some(items)
    }
}
