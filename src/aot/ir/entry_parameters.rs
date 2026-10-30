use super::generated::{EntryParameter, Function};
use super::ids::TypeId;
use super::types::TypeTable;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct EntryPosition {
    pub kind: EntryParameter,
    pub index: u32,
}

impl EntryPosition {
    pub fn new(kind: EntryParameter, index: u32) -> EntryPosition {
        EntryPosition { kind, index }
    }

    pub fn single(kind: EntryParameter) -> EntryPosition {
        EntryPosition { kind, index: 0 }
    }
}

impl Function {
    fn entry_parameter_count_of(&self, kind: EntryParameter) -> usize {
        match kind {
            EntryParameter::Capture => self.captures.len(),
            EntryParameter::Parameter => self.parameters.len(),
            _ => usize::from(self.flags.contains(kind.present_with())),
        }
    }

    pub fn entry_parameter_count(&self) -> usize {
        let kinds = EntryParameter::ALL.into_iter();
        kinds.map(|kind| self.entry_parameter_count_of(kind)).sum()
    }

    pub fn entry_parameter(&self, index: usize) -> Option<EntryPosition> {
        let mut first = 0;
        for kind in EntryParameter::ALL {
            let count = self.entry_parameter_count_of(kind);
            if index < first + count {
                return Some(EntryPosition::new(kind, (index - first) as u32));
            }
            first += count;
        }
        None
    }

    pub fn entry_parameter_index(&self, position: EntryPosition) -> Option<usize> {
        let mut first = 0;
        for kind in EntryParameter::ALL {
            let count = self.entry_parameter_count_of(kind);
            if kind == position.kind {
                let index = position.index as usize;
                return (index < count).then_some(first + index);
            }
            first += count;
        }
        None
    }

    pub fn entry_parameter_type(&self, position: EntryPosition) -> TypeId {
        let index = position.index as usize;
        match position.kind {
            EntryParameter::Capture => self.captures[index].ty,
            EntryParameter::This => self.this_type.ty,
            EntryParameter::Callee => TypeTable::FUNCTION,
            EntryParameter::NewTarget => TypeTable::ANYTHING,
            EntryParameter::ArgumentCount => TypeTable::UINT32,
            EntryParameter::Parameter => self.parameters[index].ty,
            EntryParameter::HiddenRest => TypeTable::ARRAY,
        }
    }
}
