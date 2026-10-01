// internal/core/tristate.go

// Tristate
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct Tristate(pub u8);

impl Tristate {
    pub const UNKNOWN: Tristate = Tristate(0);
    pub const FALSE: Tristate = Tristate(1);
    pub const TRUE: Tristate = Tristate(2);

    pub const fn is_true(self) -> bool {
        self.0 == Tristate::TRUE.0
    }

    pub const fn is_true_or_unknown(self) -> bool {
        self.0 == Tristate::TRUE.0 || self.0 == Tristate::UNKNOWN.0
    }

    pub const fn is_false(self) -> bool {
        self.0 == Tristate::FALSE.0
    }

    pub const fn is_false_or_unknown(self) -> bool {
        self.0 == Tristate::FALSE.0 || self.0 == Tristate::UNKNOWN.0
    }

    pub const fn is_unknown(self) -> bool {
        self.0 == Tristate::UNKNOWN.0
    }

    pub const fn default_if_unknown(self, value: Tristate) -> Tristate {
        if self.0 == Tristate::UNKNOWN.0 {
            return value;
        }
        self
    }

    pub fn unmarshal_json(&mut self, data: &[u8]) {
        *self = match data {
            b"true" => Tristate::TRUE,
            b"false" => Tristate::FALSE,
            _ => Tristate::UNKNOWN,
        };
    }

    pub fn marshal_json(self) -> &'static [u8] {
        match self {
            Tristate::TRUE => b"true",
            Tristate::FALSE => b"false",
            _ => b"null",
        }
    }
}

pub const fn bool_to_tristate(b: bool) -> Tristate {
    if b {
        return Tristate::TRUE;
    }
    Tristate::FALSE
}
