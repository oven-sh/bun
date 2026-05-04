use bun_core::{err, Error, Global};
use bun_core::output;
use bun_core::fmt as bun_fmt;
use bun_str::strings;

// Zig: `pub fn ColonListType(comptime t: type, comptime value_resolver: anytype) type`
//
// The Zig type-generator takes (a) the value type and (b) a comptime resolver fn,
// and also branches on `comptime t == bun.schema.api.Loader`. Rust cannot take a
// fn value as a const generic, so both params collapse into one trait that the
// value type implements. Each `T` declares its own resolver and whether it is the
// schema Loader.
// TODO(port): if a single `T` ever needs two distinct resolvers, split this back
// into `<T, R: ValueResolver<T>>` with a PhantomData marker.
pub trait ColonListValue: Sized {
    /// Mirrors `comptime value_resolver(str)`.
    fn resolve_value(input: &[u8]) -> Result<Self, Error>;

    /// Mirrors `if (comptime t == bun.schema.api.Loader)`.
    const IS_LOADER: bool = false;
}

pub struct ColonListType<T: ColonListValue> {
    // TODO(port): lifetime — keys borrow slices out of CLI argv (process-lifetime
    // in practice). Phase A uses &'static; Phase B may thread a `'a` if needed.
    pub keys: Vec<&'static [u8]>,
    pub values: Vec<T>,
}

impl<T: ColonListValue> ColonListType<T> {
    pub fn init(count: usize) -> Result<Self, Error> {
        // PORT NOTE: reshaped — Zig allocs two uninit slices of `count` and
        // index-assigns in `load`; Rust uses `Vec::with_capacity` + `push`.
        let keys = Vec::with_capacity(count);
        let values = Vec::with_capacity(count);

        // TODO(port): narrow error set
        Ok(ColonListType { keys, values })
    }

    pub fn load(&mut self, input: &[&'static [u8]]) -> Result<(), Error> {
        for (_i, str) in input.iter().enumerate() {
            // Support either ":" or "=" as the separator, preferring whichever is first.
            // ":" is less confusing IMO because that syntax is used with flags
            // but "=" is what esbuild uses and I want this to be somewhat familiar for people using esbuild
            let midpoint = strings::index_of_char(str, b':')
                .unwrap_or(u32::MAX)
                .min(strings::index_of_char(str, b'=').unwrap_or(u32::MAX));
            if midpoint == u32::MAX {
                return Err(err!("InvalidSeparator"));
            }
            let midpoint = midpoint as usize;

            if T::IS_LOADER {
                if !str[0..midpoint].is_empty() && str[0] != b'.' {
                    output::pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>file extension must start with a '.'<r> <d>(while mapping loader {})<r>",
                        bun_fmt::quote(str),
                    );
                    Global::exit(1);
                }
            }

            self.keys.push(&str[0..midpoint]);
            self.values.push(match T::resolve_value(&str[midpoint + 1..str.len()]) {
                Ok(v) => v,
                Err(e) if e == err!("InvalidLoader") => {
                    output::pretty_errorln!(
                        "<r><red>error<r><d>:<r> <b>invalid loader {}<r>, expected one of:{}",
                        bun_fmt::quote(&str[midpoint + 1..str.len()]),
                        bun_fmt::enum_tag_list::<bun_bundler::options::Loader>(bun_fmt::ListStyle::Dash),
                    );
                    Global::exit(1);
                }
                Err(e) => return Err(e),
            });
        }
        Ok(())
    }

    pub fn resolve(input: &[&'static [u8]]) -> Result<Self, Error> {
        let mut list = Self::init(input.len())?;
        match list.load(input) {
            Ok(()) => {}
            Err(e) if e == err!("InvalidSeparator") => {
                output::pretty_errorln!("<r><red>error<r><d>:<r> expected \":\" separator");
                Global::exit(1);
            }
            Err(e) => return Err(e),
        }
        Ok(list)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/colon_list_type.zig (62 lines)
//   confidence: medium
//   todos:      2
//   notes:      comptime (T, resolver_fn) collapsed into ColonListValue trait; keys borrow argv as &'static
// ──────────────────────────────────────────────────────────────────────────
