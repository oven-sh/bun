use super::wire::{Event, Kind};
use super::{Global, Wayland};
use crate::abi::Rect;
use crate::platform::Display;

#[derive(Clone, Default)]
pub struct Output {
    /// In the registry.
    pub name: u32,
    pub object: u32,
    logical: u32,
    label: String,
    origin: [i32; 2],
    size: [i32; 2],
    pixels: [i32; 2],
    is_turned: bool,
    millihertz: i32,
    whole_scale: i32,
}

impl Output {
    fn display(&self, scales_by_fractions: bool) -> Display {
        let (pixels, whole) = (
            [self.is_turned, !self.is_turned].map(|it| self.pixels[usize::from(it)]),
            self.whole_scale.max(1),
        );
        let size = if self.size[0] > 0 {
            self.size
        } else {
            pixels.map(|it| it / whole)
        };
        let fraction = (pixels[0] as f32 / size[0].max(1) as f32 * 120.).round() / 120.;
        let [x, y, width, height] =
            [self.origin[0], self.origin[1], size[0], size[1]].map(|it| it as f32);
        let bounds = Rect {
            x,
            y,
            width,
            height,
        };
        Display {
            id: match self.label.is_empty() {
                true => self.name.into(),
                false => self
                    .label
                    .bytes()
                    .fold(0x811c_9dc5u32, |hash, it| {
                        (hash ^ u32::from(it)).wrapping_mul(0x0100_0193)
                    })
                    .into(),
            },
            bounds,
            work_area: bounds,
            scale: if scales_by_fractions && fraction > 0. {
                fraction
            } else {
                whole as f32
            },
            frequency: self.millihertz as f32 / 1000.,
        }
    }
}

impl Wayland {
    pub fn add_output(&self, name: u32, version: u32) {
        let object = self.bind(name, "wl_output", version.min(4), Kind::Output);
        let logical = self.wire.create(
            Kind::LogicalOutput,
            object,
            self.global(Global::Outputs),
            1,
            &[object],
        );
        self.outputs.borrow_mut().push(Output {
            name,
            object,
            logical,
            ..Output::default()
        });
    }

    pub fn remove_output(&self, name: u32) {
        let removed: Vec<_> = self
            .outputs
            .borrow_mut()
            .extract_if(.., |it| it.name == name)
            .collect();
        for output in removed {
            self.wire.destroy(output.logical, 0);
            self.all_windows()
                .iter()
                .for_each(|it| it.left(output.object));
            self.outputs_changed.set(true);
        }
    }

    pub fn output_event(&self, event: &Event) {
        const CURRENT: u32 = 1;
        let object = if event.kind == Kind::Output {
            event.object
        } else {
            event.owner
        };
        let mut outputs = self.outputs.borrow_mut();
        let Some(output) = outputs.iter_mut().find(|it| it.object == object) else {
            return;
        };
        match (event.kind, event.opcode) {
            (Kind::Output, 0) => {
                let after_model = event.text(event.text(5).1).1;
                output.is_turned = event.u32(after_model) & 1 != 0;
                if output.logical == 0 {
                    output.origin = [event.i32(0), event.i32(1)];
                }
            }
            (Kind::Output, 1) if event.u32(0) & CURRENT != 0 => {
                (output.pixels, output.millihertz) = ([event.i32(1), event.i32(2)], event.i32(3))
            }
            (Kind::Output, 3) => output.whole_scale = event.i32(0),
            (Kind::Output, 4) | (Kind::LogicalOutput, 3) => output.label = event.text(0).0,
            (Kind::LogicalOutput, 0) => output.origin = [event.i32(0), event.i32(1)],
            (Kind::LogicalOutput, 1) => output.size = [event.i32(0), event.i32(1)],
            (_, 2) => self.outputs_changed.set(true),
            _ => {}
        }
    }

    pub fn display_of(&self, object: u32) -> Option<Display> {
        Some(
            self.outputs
                .borrow()
                .iter()
                .find(|it| it.object == object)?
                .display(self.scales_by_fractions()),
        )
    }

    /// None is the primary one. The one at the origin stands in.
    pub fn read_displays(&self) -> Vec<Display> {
        let outputs = self.outputs.borrow();
        let mut all: Vec<_> = outputs
            .iter()
            .filter(|it| it.pixels[0] > 0)
            .map(|it| it.display(self.scales_by_fractions()))
            .collect();
        all.sort_by_key(|it| (it.bounds.x, it.bounds.y) != (0., 0.));
        all
    }
}
