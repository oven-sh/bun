use crate::Error;
use bun_core::fmt as bun_fmt;
use bun_core::strings;
use bun_core::{Global, pretty_errorln};

// The value type and its resolver fn collapse into one trait that the
// value type implements. Each `T` declares its own resolver and whether it is the
// schema Loader.
pub(crate) trait ColonListValue: Sized {
    /// Parses one value from its string form.
    fn resolve_value(input: &[u8]) -> Result<Self, Error>;

    /// Whether `T` is the schema `Loader` type.
    const IS_LOADER: bool = false;
}

pub(crate) struct ColonListType<T: ColonListValue> {
    // Invariant: keys borrow slices out of CLI argv, which is process-lifetime
    // in practice — that is what makes the `&'static` typing sound.
    pub keys: Vec<&'static [u8]>,
    pub values: Vec<T>,
}

impl<T: ColonListValue> ColonListType<T> {
    pub(crate) fn init(count: usize) -> Self {
        // `Vec::with_capacity` + `push`, which is infallible here.
        let keys = Vec::with_capacity(count);
        let values = Vec::with_capacity(count);

        ColonListType { keys, values }
    }

    pub(crate) fn load(&mut self, input: &[&'static [u8]]) -> Result<(), Error> {
        for str in input.iter() {
            // Support either ":" or "=" as the separator, preferring whichever is first.
            // ":" is less confusing IMO because that syntax is used with flags
            // but "=" is what esbuild uses and I want this to be somewhat familiar for people using esbuild
            let midpoint = strings::index_of_char(str, b':')
                .unwrap_or(u32::MAX)
                .min(strings::index_of_char(str, b'=').unwrap_or(u32::MAX));
            if midpoint == u32::MAX {
                if T::IS_LOADER {
                    pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>--loader {}<r> is missing a \":\" separator. Expected <cyan>--loader .ext:loader<r>, for example <cyan>--loader .md:text<r>",
                        bun_fmt::quote(str),
                    );
                } else {
                    pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>--define {}<r> is missing a \":\" or \"=\" separator. Expected <cyan>--define key=value<r>, for example <cyan>--define process.env.NODE_ENV='\"production\"'<r>",
                        bun_fmt::quote(str),
                    );
                }
                Global::exit(1);
            }
            let midpoint = midpoint as usize;

            if T::IS_LOADER {
                if !str[0..midpoint].is_empty() && str[0] != b'.' {
                    pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>file extension must start with a '.'<r> <d>(while mapping loader {})<r>",
                        bun_fmt::quote(str),
                    );
                    Global::exit(1);
                }
            }

            self.keys.push(&str[0..midpoint]);
            self.values
                .push(match T::resolve_value(&str[midpoint + 1..str.len()]) {
                    Ok(v) => v,
                    Err(crate::Error::InvalidLoader) => {
                        pretty_errorln!(
                            "<r><red>error<r><d>:<r> <b>invalid loader {}<r>, expected one of:{}",
                            bun_fmt::quote(&str[midpoint + 1..str.len()]),
                            bun_fmt::enum_tag_list::<bun_ast::Loader, { bun_fmt::SEP_DASH }>(),
                        );
                        Global::exit(1);
                    }
                    Err(e) => return Err(e),
                });
        }
        Ok(())
    }

    pub(crate) fn resolve(input: &[&'static [u8]]) -> Result<Self, Error> {
        let mut list = Self::init(input.len());
        list.load(input)?;
        Ok(list)
    }
}
