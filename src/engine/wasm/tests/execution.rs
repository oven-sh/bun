//! Where the code of modules meets scripts and the heap.

#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod support;

fn run(source: &str) {
    let mut options = bun_engine_vm::Options::default();
    (options.use_quick_optimizer, options.use_full_optimizer) = (true, true);
    options.force_eager_compilation = true;
    options.verify_gc = true;
    support::run_with(options, source, support::helpers);
}

macro_rules! scripts {
    ($($name:ident)*) => {$(
        #[test]
        fn $name() {
            run(concat!(
                include_str!("support/text.js"),
                include_str!(concat!("js/", stringify!($name), ".js"))
            ));
        }
    )*};
}

scripts!(traps exceptions functions conversions objects suspension direct_calls);
