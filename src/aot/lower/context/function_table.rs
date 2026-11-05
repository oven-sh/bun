use std::collections::VecDeque;

use super::FileLowering;
use crate::ir::generated::{Function, SourceRange};
use crate::ir::{FunctionId, FunctionKey, Id};
use crate::lower::tables::Places;

pub(super) struct FunctionTable {
    places: Places,
    headers: Vec<Option<Function>>,
    queue: VecDeque<FunctionId>,
}

impl FunctionTable {
    pub(super) fn new(places: Places) -> FunctionTable {
        FunctionTable {
            places,
            headers: Vec::new(),
            queue: VecDeque::new(),
        }
    }

    pub(super) fn into_places(self) -> Places {
        self.places
    }

    fn header(&self, function: FunctionId) -> Option<&Function> {
        let place = self.places.find(function.index())?;
        self.headers.get(place)?.as_ref()
    }

    fn add(&mut self, function: FunctionId, header: Function) {
        let place = self.places.place(function.index());
        if self.headers.len() <= place {
            self.headers.resize_with(place + 1, || None);
        }
        self.headers[place] = Some(header);
        self.queue.push_back(function);
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn declare_function(
        &mut self,
        key: FunctionKey,
        create_header: impl FnOnce(&mut Self) -> Function,
    ) -> FunctionId {
        debug_assert_eq!(
            key.home_file(),
            self.file,
            "a file declares its own functions"
        );
        let function = self.fragment.declare_function(key);
        if self.functions.header(function).is_some() {
            return function;
        }
        let mut header = create_header(self);
        if self.functions.header(function).is_some() {
            return function;
        }
        debug_assert!(header.body.code.is_empty(), "a header has no body");
        if !self.inputs.options.embeds_function_text {
            header.text = SourceRange::default();
        }
        self.functions.add(function, header);
        function
    }

    pub(crate) fn reference_function(&mut self, key: FunctionKey) -> FunctionId {
        self.fragment.declare_function(key)
    }

    pub(crate) fn function_key(&self, function: FunctionId) -> FunctionKey {
        self.fragment.function_key(function)
    }

    pub(crate) fn function_header(&self, function: FunctionId) -> &Function {
        self.functions
            .header(function)
            .expect("the function was declared by declare_function")
    }

    pub(in crate::lower) fn take_next_function(&mut self) -> Option<FunctionId> {
        self.functions.queue.pop_front()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header_at(position: u32) -> Function {
        Function {
            position,
            ..Function::default()
        }
    }

    fn position_of(table: &FunctionTable, function: FunctionId) -> Option<u32> {
        table.header(function).map(|header| header.position)
    }

    #[test]
    fn table_keeps_one_header_per_declared_function() {
        let [low, high] = [FunctionId::new(2), FunctionId::new(90_000)];
        let mut places = Places::default();
        places.begin_file();
        let mut first_file = FunctionTable::new(places);
        first_file.add(high, header_at(10));
        first_file.add(low, header_at(20));
        assert_eq!(first_file.headers.len(), 2);
        assert_eq!(position_of(&first_file, high), Some(10));
        assert_eq!(position_of(&first_file, low), Some(20));
        assert_eq!(position_of(&first_file, FunctionId::new(3)), None);
        assert_eq!(first_file.queue, [high, low]);

        let mut places = first_file.into_places();
        places.begin_file();
        let mut second_file = FunctionTable::new(places);
        assert_eq!(position_of(&second_file, high), None);
        second_file.add(low, header_at(30));
        assert_eq!(position_of(&second_file, low), Some(30));
        assert_eq!(position_of(&second_file, high), None);
    }
}
