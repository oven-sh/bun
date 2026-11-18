//! https://learn.microsoft.com/windows/win32/directcomp/directcomposition-portal

use std::rc::Rc;
use std::time::{Duration, Instant};

use super::gpu::Device;
use super::pixels::{Buffer, capacity_for, next_id};
use crate::hash::FastMap;
use crate::motion::sample;
use crate::paint::flatten::{Curve, Lifted};
use crate::paint::raster::{IntRect, Pixel};
use crate::platform::{Painter, Pixels};
use crate::win32::com::{Borrowed, Interface as _, Outcome, Status, made};
use crate::win32::*;

const BGRA: u32 = 87;
const PREMULTIPLIED: u32 = 1;
const OPAQUE: u32 = 3;

/// Where pixels are painted before they are sent. Only the pages that are written to take memory.
struct Scratch {
    start: *mut Pixel,
    size: (i32, i32),
}

impl Scratch {
    fn new(size: (i32, i32)) -> Outcome<Scratch> {
        // SAFETY: wherever there is room.
        let start = unsafe {
            VirtualAlloc(
                std::ptr::null_mut(),
                size.0 as usize * size.1 as usize * 4,
                MEM_RESERVE | MEM_COMMIT,
                PAGE_READWRITE,
            )
        };
        if start.is_null() {
            Err(Status::FAILED)
        } else {
            Ok(Scratch {
                start: start.cast(),
                size,
            })
        }
    }

    fn pixels(&mut self) -> &mut [Pixel] {
        // SAFETY: what was allocated.
        unsafe {
            std::slice::from_raw_parts_mut(self.start, self.size.0 as usize * self.size.1 as usize)
        }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        // SAFETY: nothing borrows it.
        unsafe { VirtualFree(self.start.cast(), 0, MEM_RELEASE) };
    }
}

struct Contents {
    id: u64,
    surface: IDCompositionVirtualSurface,
    capacity: (i32, i32),
    is_opaque: bool,
}

struct Overlay {
    clip: IDCompositionVisual3,
    shape: IDCompositionRectangleClip,
    picture: IDCompositionVisual3,
    shown: Option<Lifted>,
}

pub struct Tree {
    pub device: Rc<Device>,
    target: IDCompositionTarget,
    root: IDCompositionVisual3,
    contents: Option<Contents>,
    scratch: Option<Scratch>,
    overlays: Vec<Overlay>,
    is_boosted: bool,
    /// By their contents, with how long they are kept.
    pictures: FastMap<u128, (IDCompositionSurface, Instant)>,
}

fn device_rect(
    IntRect {
        left,
        top,
        right,
        bottom,
    }: IntRect,
) -> DeviceRect {
    DeviceRect {
        left,
        top,
        right,
        bottom,
    }
}

impl Device {
    fn visual(&self) -> Outcome<IDCompositionVisual3> {
        made(|it| self.composition.create_visual(it))?.cast()
    }

    /// `pixels` has those of the whole surface, in rows of `width`.
    fn send(
        &self,
        to: &IDCompositionSurface,
        area: IntRect,
        pixels: &[Pixel],
        width: usize,
    ) -> Outcome {
        const MAX_SIDE: i32 = 2048;
        for top in (area.top..area.bottom).step_by(MAX_SIDE as usize) {
            for left in (area.left..area.right).step_by(MAX_SIDE as usize) {
                self.send_at_once(
                    to,
                    area.intersect(IntRect::new(left, top, left + MAX_SIDE, top + MAX_SIDE)),
                    pixels,
                    width,
                )?;
            }
        }
        Ok(())
    }

    fn send_at_once(
        &self,
        to: &IDCompositionSurface,
        area: IntRect,
        pixels: &[Pixel],
        width: usize,
    ) -> Outcome {
        let pixels = pixels.get(
            area.top as usize * width + area.left as usize
                ..(area.bottom as usize - 1) * width + area.right as usize,
        );
        let (pixels, mut at) = (
            pixels.ok_or(Status::INVALID_ARGUMENT)?,
            DevicePoint::default(),
        );
        let texture =
            made(|it| to.begin_draw(&device_rect(area), &ID3D11Texture2D::ID, it, &mut at))?;
        let (left, top) = (at.x as u32, at.y as u32);
        let place = D3dBox {
            left,
            top,
            front: 0,
            right: left + area.width() as u32,
            bottom: top + area.height() as u32,
            back: 1,
        };
        // SAFETY: from the first pixel of the area to the last.
        self.context.update_subresource(
            texture.borrowed(),
            0,
            &place,
            unsafe { Raw::new(pixels.as_ptr()) },
            width as u32 * 4,
            0,
        );
        to.end_draw().ok()
    }

    /// `values` are by their positions in a cycle, and not all the same.
    fn animation(
        &self,
        [start, cycle, cycles]: [f64; 3],
        values: &[[f32; 2]],
    ) -> Outcome<IDCompositionAnimation> {
        let (animation, mut now, mut rate) =
            (made(|it| self.composition.create_animation(it))?, 0, 0);
        QueryPerformanceCounter(&mut now);
        QueryPerformanceFrequency(&mut rate);
        let ago = (crate::surface::milliseconds(Instant::now()) - start) / 1000.;
        animation
            .set_absolute_begin_time(now - (ago * rate as f64) as i64)
            .ok()?;
        let (cycle, [first, last]) = (cycle / 1000., [values[0][1], values[values.len() - 1][1]]);
        let all: Vec<_> = [[0., first]]
            .iter()
            .chain(values)
            .chain(&[[1., last]])
            .map(|it| [it[0].clamp(0., 1.), it[1]])
            .collect();
        for [[from, a], [to, b]] in all
            .array_windows()
            .filter(|[from, to]| from[0] < to[0] && f64::from(from[0]) < cycles)
        {
            animation
                .add_cubic(
                    f64::from(*from) * cycle,
                    *a,
                    (b - a) / ((to - from) * cycle as f32),
                    0.,
                    0.,
                )
                .ok()?;
        }
        if cycles > 1. {
            animation.add_repeat(cycle, cycle).ok()?;
        }
        if cycles.is_finite() {
            let at_end = sample(
                values,
                if cycles.fract() == 0. {
                    1.
                } else {
                    cycles.fract() as f32
                },
            );
            animation
                .end(cycle * cycles, at_end.map_or(last, |it| it.0[1]))
                .ok()?;
        }
        Ok(animation)
    }

    fn fade(&self, picture: &IDCompositionVisual3, curve: Option<&Curve>) -> Outcome {
        let values = curve.map(|it| {
            it.samples
                .as_chunks()
                .0
                .iter()
                .map(|&[at, opacity]| [at, opacity.clamp(0., 1.)])
                .collect::<Vec<_>>()
        });
        match curve.zip(values.filter(|it| !it.is_empty())) {
            Some((curve, values)) => picture
                .animate_opacity(self.animation(curve.timing, &values)?.borrowed())
                .ok(),
            None => picture.set_opacity(1.).ok(),
        }
    }

    /// Around the middle of `rect`.
    fn turn(
        &self,
        picture: &IDCompositionVisual3,
        curve: Option<&Curve>,
        rect: IntRect,
    ) -> Outcome {
        let Some(curve) = curve.filter(|it| it.samples.len() >= 7) else {
            return picture.set_transform(Borrowed::default()).ok();
        };
        let (matrix, x, y) = (
            made(|it| self.composition.create_matrix_transform(it))?,
            rect.width() as f32 / 2.,
            rect.height() as f32 / 2.,
        );
        let from_corner = |&[at, a, b, c, d, e, f]: &[f32; 7]| {
            (
                at,
                [a, b, c, d, e + x - a * x - c * y, f + y - b * x - d * y],
            )
        };
        let samples: Vec<_> = curve
            .samples
            .as_chunks()
            .0
            .iter()
            .map(from_corner)
            .collect();
        for index in 0..6 {
            let (values, row, column) = (
                samples
                    .iter()
                    .map(|it| [it.0, it.1[index]])
                    .collect::<Vec<_>>(),
                index as i32 / 2,
                index as i32 % 2,
            );
            match values.iter().all(|it| it[1] == values[0][1]) {
                true => matrix.set_matrix_element(row, column, values[0][1]).ok()?,
                false => matrix
                    .animate_matrix_element(
                        row,
                        column,
                        self.animation(curve.timing, &values)?.borrowed(),
                    )
                    .ok()?,
            }
        }
        picture.set_transform(matrix.borrowed()).ok()
    }

    fn overlay(&self) -> Outcome<Overlay> {
        const SOFT: i32 = 0;
        const LINEAR: i32 = 1;
        const MULTIPLY: i32 = 1;
        let (clip, picture, shape) = (
            self.visual()?,
            self.visual()?,
            made(|it| self.composition.create_rectangle_clip(it))?,
        );
        clip.set_clip(shape.borrowed()).ok()?;
        clip.set_border_mode(SOFT).ok()?;
        clip.set_opacity_mode(MULTIPLY).ok()?;
        clip.add_visual(picture.borrowed(), 0, Borrowed::default())
            .ok()?;
        picture.set_bitmap_interpolation_mode(LINEAR).ok()?;
        Ok(Overlay {
            clip,
            shape,
            picture,
            shown: None,
        })
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        self.boost(false);
        _ = self.target.set_root(Borrowed::default());
        _ = self.commit();
    }
}

impl Tree {
    /// In front of what GDI has put into the window, which it takes over. It shows from the first `commit`.
    pub fn new(
        device: Rc<Device>,
        window: Handle,
        painted: Option<Buffer>,
        is_opaque: bool,
    ) -> Outcome<Tree> {
        let (target, root) = (
            made(|it| device.composition.create_target_for_hwnd(window, 1, it))?,
            device.visual()?,
        );
        target.set_root(root.borrowed()).ok()?;
        let mut tree = Tree {
            device,
            target,
            root,
            contents: None,
            scratch: None,
            overlays: Vec::new(),
            is_boosted: false,
            pictures: FastMap::default(),
        };
        if let Some(mut painted) = painted {
            let (capacity, id) = (painted.bitmap.size, painted.id);
            let surface = tree
                .replace_contents(id, capacity, is_opaque)?
                .surface
                .cast()?;
            tree.device.send(
                &surface,
                IntRect::new(0, 0, capacity.0, capacity.1),
                painted.bitmap.pixels(),
                capacity.0 as usize,
            )?;
        }
        Ok(tree)
    }

    fn replace_contents(
        &mut self,
        id: u64,
        capacity: (i32, i32),
        is_opaque: bool,
    ) -> Outcome<&Contents> {
        let alpha = if is_opaque { OPAQUE } else { PREMULTIPLIED };
        let surface = made(|it| {
            self.device.composition.create_virtual_surface(
                capacity.0 as u32,
                capacity.1 as u32,
                BGRA,
                alpha,
                it,
            )
        })?;
        self.root.set_content(surface.borrowed()).ok()?;
        Ok(self.contents.insert(Contents {
            id,
            surface,
            capacity,
            is_opaque,
        }))
    }

    pub fn paint(&mut self, shown: (i32, i32), is_opaque: bool, paint: Painter) -> Outcome {
        let before = self.contents.as_ref().map(|it| (it.capacity, it.is_opaque));
        let capacity = capacity_for(shown, before.map(|it| it.0));
        let is_new = before != Some((capacity, is_opaque));
        if is_new {
            self.replace_contents(next_id(), capacity, is_opaque)?;
        }
        let Contents { id, surface, .. } = self.contents.as_ref().ok_or(Status::FAILED)?;
        let kept = self.scratch.take().filter(|it| it.size == capacity);
        let (data, width) = (
            self.scratch
                .insert(kept.map_or_else(|| Scratch::new(capacity), Ok)?)
                .pixels(),
            capacity.0 as usize,
        );
        let painted = paint(Pixels {
            id: *id,
            data,
            width,
            shown,
            platform_moves: true,
        });
        let surface: IDCompositionSurface = surface.cast()?;
        for area in painted.moved {
            let from = area.offset(0, -painted.moved_by);
            surface
                .scroll(
                    &device_rect(from),
                    &device_rect(from.union(area)),
                    0,
                    painted.moved_by,
                )
                .ok()?;
        }
        let areas = if is_new {
            vec![IntRect::new(0, 0, capacity.0, capacity.1)]
        } else {
            painted.areas
        };
        areas
            .into_iter()
            .try_for_each(|area| self.device.send(&surface, area, data, width))
    }

    /// A display that varies its rate goes faster.
    pub fn boost(&mut self, is_on: bool) {
        if std::mem::replace(&mut self.is_boosted, is_on) != is_on {
            _ = boost_compositor_clock(is_on.into());
        }
    }

    pub fn commit(&self) -> Outcome {
        self.device.composition.commit().ok()
    }

    /// Returns the contents that it keeps until the next call.
    pub fn show_lifted(&mut self, mut all: Vec<Lifted>) -> Outcome<Vec<u128>> {
        const MAY_COME_BACK: Duration = Duration::from_secs(20);
        let (device, now) = (&self.device, Instant::now());
        all.sort_by_key(Lifted::order);
        let mut unused = std::mem::take(&mut self.overlays);
        let order = |all: &[Overlay]| all.iter().map(|it| it.clip.as_ptr()).collect::<Vec<_>>();
        let order_before = order(&unused);
        let mut take = |lifted: &Lifted| {
            let is_same = |it: &Overlay| {
                it.shown
                    .as_ref()
                    .is_some_and(|it| it.contents == lifted.contents)
            };
            unused
                .iter()
                .position(is_same)
                .map(|index| unused.remove(index))
        };
        let same: Vec<_> = all.iter().map(&mut take).collect();
        for (mut lifted, same) in all.into_iter().zip(same) {
            let Lifted {
                clip,
                rect,
                contents: Some(contents),
                radius,
                opacity,
                ..
            } = lifted
            else {
                continue;
            };
            if let Some(pixels) = lifted
                .pixels
                .take()
                .filter(|_| !self.pictures.contains_key(&contents))
            {
                let surface = made(|it| {
                    device.composition.create_surface(
                        rect.width() as u32,
                        rect.height() as u32,
                        BGRA,
                        PREMULTIPLIED,
                        it,
                    )
                })?;
                device.send(
                    &surface,
                    rect.offset(-rect.left, -rect.top),
                    pixels.as_chunks().0,
                    rect.width(),
                )?;
                self.pictures.insert(contents, (surface, now));
            }
            let Some((surface, kept_until)) = self.pictures.get_mut(&contents) else {
                continue;
            };
            *kept_until = if lifted.fades.is_some() {
                now
            } else {
                now + MAY_COME_BACK
            };
            let mut overlay = same
                .or_else(|| unused.pop())
                .map_or_else(|| device.overlay(), Ok)?;
            let before = overlay.shown.as_ref();
            if before.is_none_or(|it| {
                (it.clip, it.rect, it.radius, it.opacity) != (clip, rect, radius, opacity)
            }) {
                let IntRect {
                    left,
                    top,
                    right,
                    bottom,
                } = clip.offset(-rect.left, -rect.top);
                overlay.clip.set_offset_x(rect.left as f32).ok()?;
                overlay.clip.set_offset_y(rect.top as f32).ok()?;
                overlay.clip.set_opacity(opacity).ok()?;
                overlay
                    .shape
                    .set([left, top, right, bottom].map(|it| it as f32), radius)?;
            }
            if before.is_none_or(|it| it.contents != lifted.contents) {
                overlay.picture.set_content(surface.borrowed()).ok()?;
            }
            if before.and_then(|it| it.fades.as_ref()) != lifted.fades.as_ref() {
                device.fade(&overlay.picture, lifted.fades.as_ref())?;
            }
            let size = |it: IntRect| (it.width(), it.height());
            if before.and_then(|it| Some((it.moves.as_ref()?, size(it.rect))))
                != lifted.moves.as_ref().map(|it| (it, size(rect)))
            {
                device.turn(&overlay.picture, lifted.moves.as_ref(), rect)?;
            }
            overlay.shown = Some(lifted);
            self.overlays.push(overlay);
        }
        if order(&self.overlays) != order_before {
            self.root.remove_all_visuals().ok()?;
            // Without a sibling, this puts it in front of all.
            self.overlays.iter().try_for_each(|it| {
                self.root
                    .add_visual(it.clip.borrowed(), 0, Borrowed::default())
                    .ok()
            })?;
        }
        self.pictures
            .retain(|_, (_, kept_until)| *kept_until >= now);
        Ok(self.pictures.keys().copied().collect())
    }

    pub fn rest(&mut self) {
        self.scratch = None;
        self.device.rest();
    }
}
