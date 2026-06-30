/// Canonical home is here (the parser is the consumer
/// — `P::should_allow_unresolved_dynamic_specifier`). `bun_bundler::options`
/// re-exports this so `BundleOptions.allow_unresolved` and
/// `Parser.Options.allow_unresolved` are the SAME nominal type and
/// `ParseTask::run_with_source_code` can hand `&transpiler.options.allow_unresolved`
/// straight through.
#[derive(Debug, Clone, Default)]
pub enum AllowUnresolved {
    /// Default. Skip all checks — current behavior.
    #[default]
    All,
    /// Always error on dynamic specifiers.
    None,
    /// Glob patterns; at least one must match the extracted shape.
    Patterns(Box<[Box<[u8]>]>),
}
impl AllowUnresolved {
    // Taken by address from `Options::init` (`&AllowUnresolved::DEFAULT`); rvalue
    // static promotion gives the borrow `'static` lifetime.
    pub const DEFAULT: AllowUnresolved = AllowUnresolved::All;

    /// Normalize from raw CLI/JS input.
    /// [] → .none, contains "*" → .all, else → .patterns
    pub fn from_strings(strs: Box<[Box<[u8]>]>) -> AllowUnresolved {
        if strs.is_empty() {
            return AllowUnresolved::None;
        }
        for s in strs.iter() {
            if &**s == b"*" {
                return AllowUnresolved::All;
            }
        }
        AllowUnresolved::Patterns(strs)
    }

    /// shape is the extracted template representation (may be "").
    pub fn allows(&self, shape: &[u8]) -> bool {
        match self {
            AllowUnresolved::All => true,
            AllowUnresolved::None => false,
            AllowUnresolved::Patterns(pats) => {
                for p in pats.iter() {
                    if bun_glob::r#match(p, shape).matches() {
                        return true;
                    }
                }
                false
            }
        }
    }
}
