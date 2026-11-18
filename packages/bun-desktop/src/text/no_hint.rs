//! Core Text does not hint.

use super::fonts::{Face, File};
use crate::gfx::Path;

pub struct Styles;

impl Styles {
    pub fn new(_: &File) -> Option<Styles> {
        None
    }
}

pub fn release_memory() {}

pub fn outline(_: &Face, _: u32, _: f32) -> Option<Path> {
    None
}
