//! Every script of the other two, where no function of a module is compiled.

#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod support;

fn run(source: &str) {
    let mut options = support::options();
    (options.use_wasm_baseline_jit, options.use_wasm_optimizer) = (false, false);
    // The scripts of a module meet those of the optimizer, which has no entry of its own to call.
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
scripts!(calls compile global instance memory module namespace strings table);
