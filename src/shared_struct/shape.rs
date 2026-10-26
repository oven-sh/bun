use std::sync::Arc;

use bun_collections::HashMap;

use crate::value::SymbolRecord;

/// The name of a field: a string, as UTF-16 code units so lone surrogates survive, or a symbol.
#[derive(Debug)]
pub enum FieldKey {
    Name(Box<[u16]>),
    Symbol(Arc<SymbolRecord>),
}

/// The field names of a shared struct, in declaration order. Names are looked up without allocating.
pub struct StructShape {
    keys: Box<[FieldKey]>,
    index: HashMap<Box<[u16]>, usize>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ShapeError {
    /// The name at this position repeats an earlier one.
    Duplicate(usize),
}

/// Whether `name` is a canonical array index: `"0"`, `"17"`, up to `"4294967294"`, no leading zeros.
pub fn is_array_index(name: &[u16]) -> bool {
    if name.is_empty() || name.len() > 10 || (name.len() > 1 && name[0] == u16::from(b'0')) {
        return false;
    }
    let mut value: u64 = 0;
    for &unit in name {
        if !(u16::from(b'0')..=u16::from(b'9')).contains(&unit) {
            return false;
        }
        value = value * 10 + u64::from(unit - u16::from(b'0'));
    }
    value < u64::from(u32::MAX)
}

impl StructShape {
    pub fn new(keys: Vec<FieldKey>) -> Result<Arc<Self>, ShapeError> {
        let mut index = HashMap::with_capacity(keys.len());
        for (i, key) in keys.iter().enumerate() {
            match key {
                FieldKey::Name(name) => {
                    if index.insert(name.clone(), i).is_some() {
                        return Err(ShapeError::Duplicate(i));
                    }
                }
                FieldKey::Symbol(record) => {
                    let repeated = keys[..i].iter().any(
                        |earlier| matches!(earlier, FieldKey::Symbol(other) if other.same_as(record)),
                    );
                    if repeated {
                        return Err(ShapeError::Duplicate(i));
                    }
                }
            }
        }
        Ok(Arc::new(Self {
            keys: keys.into(),
            index,
        }))
    }

    #[allow(
        clippy::len_without_is_empty,
        reason = "a shape is never asked whether it is empty"
    )]
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn key(&self, i: usize) -> &FieldKey {
        &self.keys[i]
    }

    /// The slot of the field called `name`.
    pub fn index_of(&self, name: &[u16]) -> Option<usize> {
        self.index.get(name).copied()
    }

    /// The slot of the field named by the symbol that `symbol` stands for.
    pub fn index_of_symbol(&self, symbol: &SymbolRecord) -> Option<usize> {
        self.keys
            .iter()
            .position(|key| matches!(key, FieldKey::Symbol(other) if other.same_as(symbol)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::value::SymbolKind;

    fn utf16(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    fn name(text: &str) -> FieldKey {
        FieldKey::Name(utf16(text).into())
    }

    fn symbol(id: u64) -> FieldKey {
        FieldKey::Symbol(Arc::new(SymbolRecord {
            id,
            kind: SymbolKind::Unique,
            description: None,
        }))
    }

    #[test]
    fn looks_up_fields_in_declaration_order() {
        let shape = StructShape::new(vec![
            name("x"),
            name("y"),
            FieldKey::Name(vec![0xd800].into()),
        ])
        .unwrap();
        assert_eq!(shape.len(), 3);
        assert_eq!(shape.index_of(&utf16("y")), Some(1));
        assert_eq!(shape.index_of(&[0xd800]), Some(2));
        assert_eq!(shape.index_of(&utf16("z")), None);
        assert!(matches!(shape.key(0), FieldKey::Name(n) if **n == *utf16("x")));
    }

    #[test]
    fn rejects_duplicates_and_keeps_array_indices() {
        assert_eq!(
            StructShape::new(vec![name("a"), name("b"), name("a")]).err(),
            Some(ShapeError::Duplicate(2))
        );
        // A field may be named by an array index like any other key.
        let shape = StructShape::new(vec![name("a"), name("12"), name("0")]).unwrap();
        assert_eq!(shape.index_of(&utf16("12")), Some(1));
        assert!(StructShape::new(vec![name("01"), name("-1"), name("4294967295")]).is_ok());
        assert!(is_array_index(&utf16("4294967294")));
        assert!(!is_array_index(&utf16("")));
    }

    #[test]
    fn symbols_name_fields_too() {
        let shape = StructShape::new(vec![name("a"), symbol(7), symbol(8)]).unwrap();
        let seven = SymbolRecord {
            id: 7,
            kind: SymbolKind::Unique,
            description: None,
        };
        let nine = SymbolRecord {
            id: 9,
            kind: SymbolKind::Unique,
            description: None,
        };
        assert_eq!(shape.index_of_symbol(&seven), Some(1));
        assert_eq!(shape.index_of_symbol(&nine), None);
        assert_eq!(
            StructShape::new(vec![symbol(7), name("a"), symbol(7)]).err(),
            Some(ShapeError::Duplicate(2))
        );
    }
}
