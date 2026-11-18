//! One walk of `simplify` that looks less far.

use super::Analyses;
use super::simplify::{Effort, walk_once};
use crate::ir::Function;
use crate::target::Target;

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, target: Target) {
    walk_once(function, analyses, target, Effort::Low);
}
