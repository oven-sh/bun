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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tristate() {
        assert_eq!(Tristate::default(), Tristate::UNKNOWN);
        assert!(Tristate::TRUE.is_true() && !Tristate::UNKNOWN.is_true());
        assert!(Tristate::UNKNOWN.is_true_or_unknown() && !Tristate::FALSE.is_true_or_unknown());
        assert!(Tristate::FALSE.is_false() && Tristate::UNKNOWN.is_false_or_unknown());
        assert!(Tristate::UNKNOWN.is_unknown() && !Tristate::TRUE.is_false_or_unknown());
        assert_eq!(
            Tristate::UNKNOWN.default_if_unknown(Tristate::TRUE),
            Tristate::TRUE
        );
        assert_eq!(
            Tristate::FALSE.default_if_unknown(Tristate::TRUE),
            Tristate::FALSE
        );
        assert_eq!(
            (bool_to_tristate(true), bool_to_tristate(false)),
            (Tristate::TRUE, Tristate::FALSE)
        );
        let mut t = Tristate::UNKNOWN;
        t.unmarshal_json(b"true");
        assert_eq!((t, t.marshal_json()), (Tristate::TRUE, &b"true"[..]));
        t.unmarshal_json(b"false");
        assert_eq!((t, t.marshal_json()), (Tristate::FALSE, &b"false"[..]));
        t.unmarshal_json(b"1");
        assert_eq!((t, t.marshal_json()), (Tristate::UNKNOWN, &b"null"[..]));
        assert_eq!(Tristate::TRUE.string(), b"TSTrue");
        assert_eq!(Tristate::UNKNOWN.string(), b"TSUnknown");
        assert_eq!(Tristate(7).string(), b"Tristate(7)");
    }
}
