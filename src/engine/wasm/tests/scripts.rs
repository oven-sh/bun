//! The JavaScript interface, a script for each topic.

mod support;

macro_rules! scripts {
    ($($name:ident)*) => {$(
        #[test]
        fn $name() {
            support::run(include_str!(concat!("js/", stringify!($name), ".js")));
        }
    )*};
}

scripts! {
    calls
    compile
    global
    instance
    memory
    module
    namespace
    strings
    table
}

#[test]
fn disabled() {
    let message = Some(bun_engine_text::StringRef::from_literal("not here"));
    support::run_with(Default::default(), include_str!("js/disabled.js"), |cx| {
        drop(cx.global().webassembly_disabled_message().replace(message));
    });
}
