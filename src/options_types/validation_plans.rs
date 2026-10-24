//! `JSON.parse<T>(text)` and `validate<T>(value)` in a program that is not compiled ahead of time: the transpiler erases `T`,
//! so it asks for what the run time makes the validator of, and writes that into the call.

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ValidatingFunction {
    Parse,
    Validate,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PlannedValidation {
    /// Where the first type argument of the call begins in the text of the file.
    pub type_argument: u32,
    pub function: ValidatingFunction,
    /// JSON. The nodes of `T`.
    pub plan: Box<[u8]>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RefusedValidation {
    /// In the text of the file.
    pub position: u32,
    pub message: Vec<u8>,
}

/// Of one file. A call that is in neither list has no type to validate against.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct ValidationPlans {
    /// Ascending by `type_argument`.
    pub calls: Vec<PlannedValidation>,
    pub refused: Vec<RefusedValidation>,
}

impl ValidationPlans {
    pub fn find(&self, type_argument: u32) -> Option<&PlannedValidation> {
        let index = self
            .calls
            .binary_search_by_key(&type_argument, |call| call.type_argument);
        index.ok().map(|index| &self.calls[index])
    }
}

/// Where the first token at or behind `at` begins. The transpiler and the checker name a call by the place of its first type
/// argument, and each of them gets there with this.
pub fn skip_blanks_and_comments(text: &[u8], at: u32) -> u32 {
    let mut at = at as usize;
    loop {
        let rest = text.get(at..).unwrap_or_default();
        let blank = rest.len() - rest.trim_ascii_start().len();
        let comment = match &rest[blank..] {
            [b'/', b'/', line @ ..] => {
                let end = bun_core::strings::index_of_char_usize(line, b'\n');
                2 + end.unwrap_or(line.len())
            }
            [b'/', b'*', block @ ..] => {
                let end = bun_core::strings::index_of(block, b"*/");
                2 + end.map_or(block.len(), |end| end + 2)
            }
            _ => 0,
        };
        if blank + comment == 0 {
            return at as u32;
        }
        at += blank + comment;
    }
}

/// Whom the transpiler asks. It knows nothing of types.
#[derive(Copy, Clone)]
pub struct ValidationPlanSource {
    /// Handed to `find`. It outlives the parse.
    pub context: *const core::ffi::c_void,
    /// `None`: the file or what it imports could not be loaded, and the log says why.
    pub find: fn(
        context: *const core::ffi::c_void,
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
    ) -> Option<ValidationPlans>,
}
