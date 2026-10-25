use std::sync::Arc;

use bun_collections::HashMap;

/// The field names of a shared struct, in declaration order. Names are UTF-16 code units so
/// lone surrogates survive, and are looked up without allocating.
pub struct StructShape {
    names: Box<[Box<[u16]>]>,
    index: HashMap<Box<[u16]>, usize>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ShapeError {
    /// The name at this position repeats an earlier one.
    Duplicate(usize),
    /// The name at this position is an array index, which an object view cannot keep apart
    /// from an element.
    ArrayIndex(usize),
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
    pub fn new(names: Vec<Vec<u16>>) -> Result<Arc<Self>, ShapeError> {
        let mut index = HashMap::with_capacity(names.len());
        let mut boxed = Vec::with_capacity(names.len());
        for (i, name) in names.into_iter().enumerate() {
            if is_array_index(&name) {
                return Err(ShapeError::ArrayIndex(i));
            }
            let name: Box<[u16]> = name.into();
            if index.insert(name.clone(), i).is_some() {
                return Err(ShapeError::Duplicate(i));
            }
            boxed.push(name);
        }
        Ok(Arc::new(Self {
            names: boxed.into(),
            index,
        }))
    }

    #[allow(
        clippy::len_without_is_empty,
        reason = "a shape is never asked whether it is empty"
    )]
    pub fn len(&self) -> usize {
        self.names.len()
    }

    pub fn name(&self, i: usize) -> &[u16] {
        &self.names[i]
    }

    /// The slot of the field called `name`.
    pub fn index_of(&self, name: &[u16]) -> Option<usize> {
        self.index.get(name).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    #[test]
    fn looks_up_fields_in_declaration_order() {
        let shape = StructShape::new(vec![utf16("x"), utf16("y"), vec![0xd800]]).unwrap();
        assert_eq!(shape.len(), 3);
        assert_eq!(shape.index_of(&utf16("y")), Some(1));
        assert_eq!(shape.index_of(&[0xd800]), Some(2));
        assert_eq!(shape.index_of(&utf16("z")), None);
        assert_eq!(shape.name(0), &utf16("x")[..]);
    }

    #[test]
    fn rejects_duplicates_and_array_indices() {
        assert_eq!(
            StructShape::new(vec![utf16("a"), utf16("b"), utf16("a")]).err(),
            Some(ShapeError::Duplicate(2))
        );
        assert_eq!(
            StructShape::new(vec![utf16("a"), utf16("12")]).err(),
            Some(ShapeError::ArrayIndex(1))
        );
        assert!(StructShape::new(vec![utf16("01"), utf16("-1"), utf16("4294967295")]).is_ok());
        assert!(is_array_index(&utf16("4294967294")));
        assert!(!is_array_index(&utf16("")));
    }
}
