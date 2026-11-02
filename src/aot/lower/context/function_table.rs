use std::collections::VecDeque;

use super::FileLowering;
use crate::ir::generated::{Function, SourceRange};
use crate::ir::{FunctionId, FunctionKey, Id};

#[derive(Default)]
pub(super) struct FunctionTable {
    headers: Vec<Option<Function>>,
    queue: VecDeque<FunctionId>,
}

impl FunctionTable {
    fn header(&self, function: FunctionId) -> Option<&Function> {
        self.headers.get(function.index())?.as_ref()
    }

    fn add(&mut self, function: FunctionId, header: Function) {
        if self.headers.len() <= function.index() {
            self.headers.resize_with(function.index() + 1, || None);
        }
        self.headers[function.index()] = Some(header);
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
