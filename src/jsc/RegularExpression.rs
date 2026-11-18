//! `bun_yarr` for the filters of bundler plugins (JSBundlerPlugin.h), which run on any thread.

use bun_core::String as BunString;
use bun_yarr::Compiled;

/// Null if the pattern is refused.
#[unsafe(no_mangle)]
extern "C" fn Bun__RegularExpression__compile(
    pattern: &BunString,
    flags: u16,
) -> Option<Box<Compiled>> {
    let compiled = pattern.with_text(|pattern| Compiled::new(pattern, flags));
    compiled.ok().map(Box::new)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__RegularExpression__matches(compiled: &Compiled, input: &BunString) -> bool {
    input.with_text(|input| compiled.is_match(input))
}

#[unsafe(no_mangle)]
extern "C" fn Bun__RegularExpression__destroy(compiled: Box<Compiled>) {
    drop(compiled);
}
