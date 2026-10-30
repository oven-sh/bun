use crate::builtins::id::{BuiltinId, Feature};
use crate::ir::generated::{SourceLocation, Witness as WitnessRecord};
use crate::ir::ids::{FunctionId, ModuleId, ValueId, optional_id_from_word};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Position {
    pub module: ModuleId,
    pub offset: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Witness {
    pub function: Option<FunctionId>,
    pub value: Option<ValueId>,
    pub position: Option<Position>,
}

pub fn position_of(location: SourceLocation) -> Option<Position> {
    let module = optional_id_from_word(location.module)?;
    Some(Position {
        module,
        offset: location.position,
    })
}

pub fn witness_of(record: &WitnessRecord) -> Witness {
    Witness {
        function: record.function_id(),
        value: record.value_id(),
        position: position_of(record.location),
    }
}

pub fn builtin_of(word: u32) -> Option<BuiltinId> {
    BuiltinId::from_wire(word)
}

pub fn feature_of(word: u32) -> Option<Feature> {
    Feature::from_index(u16::try_from(word).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::ids::{ABSENT_WORD, Id};

    #[test]
    fn absent_module_has_no_position() {
        let location = SourceLocation {
            module: ABSENT_WORD,
            position: 7,
        };
        assert_eq!(position_of(location), None);
    }

    #[test]
    fn position_keeps_module_and_offset() {
        let location = SourceLocation {
            module: 3,
            position: 7,
        };
        let expected = Position {
            module: ModuleId::new(3),
            offset: 7,
        };
        assert_eq!(position_of(location), Some(expected));
    }

    #[test]
    fn positions_order_by_module_then_offset() {
        let at = |module, offset| Position {
            module: ModuleId::new(module),
            offset,
        };
        assert!(at(0, 9) < at(1, 0));
        assert!(at(1, 0) < at(1, 1));
    }

    #[test]
    fn witness_decodes_each_word() {
        let record = WitnessRecord {
            function: 2,
            value: ABSENT_WORD,
            location: SourceLocation {
                module: ABSENT_WORD,
                position: 0,
            },
        };
        let expected = Witness {
            function: Some(FunctionId::new(2)),
            value: None,
            position: None,
        };
        assert_eq!(witness_of(&record), expected);
    }

    #[test]
    fn undeclared_words_name_nothing() {
        assert_eq!(builtin_of(ABSENT_WORD), None);
        assert_eq!(builtin_of(BuiltinId::COUNT), None);
        assert_eq!(feature_of(ABSENT_WORD), None);
        assert_eq!(feature_of(u32::from(u16::MAX)), None);
    }

    #[test]
    fn declared_words_round_trip() {
        assert_eq!(
            builtin_of(BuiltinId::GlobalThis.to_wire()),
            Some(BuiltinId::GlobalThis)
        );
        let feature = Feature::ALL[0];
        assert_eq!(feature_of(u32::from(feature.index())), Some(feature));
    }
}
