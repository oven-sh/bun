//! One name table per JavaScript-facing enum.

/// An enum JavaScript refers to by name. `ALL` and `name` come from one list, so adding a
/// variant without naming it does not compile.
pub trait Named: Sized + Copy + 'static {
    const ALL: &'static [(&'static str, Self)];

    fn name(self) -> &'static str;

    fn from_name(name: &str) -> Option<Self> {
        Self::ALL.iter().find(|(n, _)| *n == name).map(|(_, v)| *v)
    }
}

/// Declares a fieldless enum together with its [`Named`] impl: `Variant = "jsName"`.
macro_rules! named_enum {
    (
        $(#[$m:meta])*
        $vis:vis enum $Name:ident {
            $( $(#[$vm:meta])* $Variant:ident = $js:literal ),* $(,)?
        }
    ) => {
        $(#[$m])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        $vis enum $Name {
            $( $(#[$vm])* $Variant ),*
        }

        impl $crate::Named for $Name {
            const ALL: &'static [(&'static str, Self)] = &[ $( ($js, $Name::$Variant) ),* ];

            fn name(self) -> &'static str {
                match self {
                    $( $Name::$Variant => $js ),*
                }
            }
        }
    };
}
pub(crate) use named_enum;
