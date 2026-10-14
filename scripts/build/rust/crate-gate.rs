//! The gate on a crate (src/bun_core/feature.rs): rustc, but every function that the crate defines is compiled as if it had
//! `#[feature::gate]` on it. That includes what the attribute cannot be written on: closures, and what macros expand to.
//! It does not include what the crate only instantiates, like a `Vec<u8>::push`, which other crates may share.
//!
//!     crate-gate <gate, in hex> <what rustc is given>...
//!
//! rustc has no flag for this. It does let a driver answer its queries, which is how clippy and miri are made, and
//! `codegen_fn_attrs` is the query that `#[link_section]` ends up in. Crates that instantiate a generic function of this one
//! read the answer from its metadata.

#![feature(rustc_private)]

extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_span;

use std::sync::OnceLock;

use rustc_middle::middle::codegen_fn_attrs::CodegenFnAttrs;
use rustc_middle::ty::TyCtxt;
use rustc_span::Symbol;
use rustc_span::def_id::LocalDefId;

static GATE: OnceLock<String> = OnceLock::new();
static RUSTC_S: OnceLock<fn(TyCtxt<'_>, LocalDefId) -> CodegenFnAttrs> = OnceLock::new();

fn codegen_fn_attrs(tcx: TyCtxt<'_>, item: LocalDefId) -> CodegenFnAttrs {
    let mut attrs = RUSTC_S.get().unwrap()(tcx, item);
    // One that has a section has a gate of its own.
    if tcx.def_kind(item).is_fn_like() && attrs.link_section.is_none() {
        // src/bun_core_macros/lib.rs and src/exe_features/lib.rs have these names too.
        let (gate, target) = (GATE.get().unwrap(), &tcx.sess.target);
        let section = if target.is_like_darwin {
            format!("__TEXT,__bun_gate_{gate},regular,pure_instructions")
        } else if target.is_like_windows {
            format!(".bg{gate}")
        } else {
            format!(".bun_gate.{gate}")
        };
        attrs.link_section = Some(Symbol::intern(&section));
    }
    attrs
}

struct CrateGate;

impl rustc_driver::Callbacks for CrateGate {
    fn config(&mut self, config: &mut rustc_interface::interface::Config) {
        config.override_queries = Some(|_, providers| {
            RUSTC_S.set(providers.queries.codegen_fn_attrs).unwrap();
            providers.queries.codegen_fn_attrs = codegen_fn_attrs;
        });
    }
}

fn main() {
    let mut args: Vec<String> = std::env::args().collect();
    GATE.set(args.remove(1)).unwrap();
    rustc_driver::run_compiler(&args, &mut CrateGate);
}
