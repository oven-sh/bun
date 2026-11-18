//! Typed entry points of built-ins, which compiled code calls in place of the native function.
//!
//! A form is a function with `#[direct_form]` that is listed in `table.rs`. Its description follows from its type:
//!
//! - A first parameter named `cx`, `vm` or `global` is the context, and says how far it reaches.
//! - A parameter named `this` comes next. One whose name starts with `_` is not passed, and the function lacks it.
//! - A function without a body is not called: its result is an operand or a constant.
//!
//! The rest is declared: what it `reads(..)` and `writes(..)`, or that it is `pure` but for what the kinds of its
//! operands depend on; the watchpoints that it `needs(..)`; the slots of the realm that it `makes(..)` on first use;
//! that it throws because it `only_lacks_room`; of an object or a symbol, whether it `gives_new` or `gives_the_same`.
//! A build with assertions checks each call against all that shows in the operands, the result and the realm. What is
//! read, and whether two results differ, is left to the tests.
//!
//! No form runs a script, because it has no frame for the script to find. The stack trace of what it throws lacks the
//! function, so the caller makes the ordinary call after all. At most a match has been recorded by then.

mod bigint;
#[cfg(debug_assertions)]
mod check;
mod conversion;
pub mod date;
mod form;
mod invoke;
mod json;
pub mod math;
pub mod number;
mod operand;
mod outcome;
mod pattern;
pub mod regexp;
pub mod search;
pub mod string;
pub mod symbol;
mod table;
pub mod uri;

#[cfg(debug_assertions)]
use check::Check;
#[cfg(debug_assertions)]
pub(crate) use check::{will_allocate, will_extend_realm, will_fire_watchpoint, will_run_script};
use form::Declaration;
pub use form::{Context, DirectForm, Quiet, Reach, State, Throws};
pub use invoke::Constant;
pub use operand::*;
pub use outcome::*;
pub use table::{Form, forms_for, intrinsic_of};
