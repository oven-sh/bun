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
