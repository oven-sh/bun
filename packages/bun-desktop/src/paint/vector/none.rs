use std::rc::Rc;

use super::Scene;
use crate::error::{Result, bail};
use crate::paint::raster::{IntRect, Pixel};

pub const MAX_AREA: i64 = 0;
pub const MAX_UNITS: usize = 1 << 20;
pub const CUTS_BETWEEN_PIXELS: bool = true;

pub enum Started {}

pub fn start(_takes_software: bool) -> Result<()> {
    bail!("there is none")
}

pub fn hand_over() -> Option<Started> {
    None
}

pub fn take_over(_: Started) {}

pub fn rest() {}

pub fn stop() {}

pub fn reads_backdrop() -> bool {
    false
}

pub struct Texture {
    pub(super) size: [i32; 2],
}

impl Texture {
    pub fn new(_: i32, _: i32) -> Result<Texture> {
        bail!("there is none")
    }

    pub fn write(&self, _: IntRect, _: &[Pixel], _: usize) -> Result<()> {
        Ok(())
    }
}

pub enum Target {}

impl Target {
    pub fn new(_: i32, _: i32, _: bool) -> Result<Target> {
        bail!("there is none")
    }

    pub fn texture(&self) -> Rc<Texture> {
        match *self {}
    }

    pub fn end_frame(&mut self, _: bool) {}

    pub fn write(&mut self, _: &[Pixel]) -> Result<()> {
        Ok(())
    }

    pub fn read(&mut self, _: IntRect, _: &mut [Pixel]) -> Result<()> {
        Ok(())
    }

    pub fn draw(&mut self, _: &mut Scene) -> Result<()> {
        Ok(())
    }
}
