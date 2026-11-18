//! Drawing, and what must be true before that.

use super::context::{Context, Extension, dirty};
use super::decoder::{
    NO_MEMORY, Result, bad_enum, bad_state, check_enum, check_state, check_value,
};
use super::formats::Component;
use super::framebuffers::{Attachment, DRAW};
use super::gl::*;
use super::programs::{Executable, sampled_by};
use crate::abi_webgl::scalar;

/// What was found out, and holds until something is dirty.
#[derive(Default)]
pub struct Plan {
    pub has_integer_target: bool,
    /// How many there are in the buffers.
    vertices: u64,
    instances: u64,
    has_attribute_per_vertex: bool,
}

fn check_effort(count: i32, instances: i32) -> Result {
    if count as u64 * instances as u64 > 1 << 30 {
        Err(NO_MEMORY)
    } else {
        Ok(())
    }
}

impl Context {
    /// Before anything is written to the framebuffer.
    pub fn prepare_target(&mut self) -> Result {
        if self.dirty & (dirty::FRAMEBUFFER | dirty::OUTPUTS) != 0 {
            if self.dirty & dirty::FRAMEBUFFER != 0 {
                self.prepare_framebuffer(DRAW)?;
                if self.framebuffers[DRAW].is_default() {
                    (self.surface.is_resolved, self.surface.was_presented) = (false, false);
                }
                self.dirty &= !dirty::FRAMEBUFFER;
            }
            self.plan.has_integer_target = self.framebuffers[DRAW]
                .drawn()
                .any(|it| it.1.format().is_some_and(|it| it.is_integer()));
        }
        Ok(())
    }

    fn check_outputs(&self, executable: &Executable) -> Result {
        let framebuffer = &self.framebuffers[DRAW];
        if let Some(format) = framebuffer
            .stencil()
            .and_then(|it| it.format())
            .filter(|_| self.is_on(STENCIL_TEST))
        {
            let most = (1 << format.bits[5]) - 1;
            let [front, back] = self.stencil.map(|it| {
                (
                    it.reference.clamp(0, most as i32),
                    it.value_mask & most,
                    it.write_mask & most,
                )
            });
            check_state(
                front == back,
                "stencil references and masks differ between the faces",
            )?;
        }
        let is_second = |it: &u32| {
            matches!(
                *it,
                SRC1_ALPHA_WEBGL | SRC1_COLOR_WEBGL..=ONE_MINUS_SRC1_ALPHA_WEBGL
            )
        };
        for (index, attachment) in framebuffer.drawn() {
            let (Some(format), blending) = (attachment.format(), &self.blending[index]) else {
                continue;
            };
            let is_float32 = format.component == Component::Float && format.bits[0] == 32;
            check_state(
                !blending.is_enabled || !is_float32 || self.has(Extension::FloatBlend),
                "32-bit floats are only blended with EXT_float_blend",
            )?;
            if blending.mask.contains(&true) && !self.is_on(RASTERIZER_DISCARD) {
                check_state(
                    executable.outputs[index] == Some(format.scalar()),
                    "the shader has no output of the right type for a draw buffer",
                )?;
                check_state(
                    !blending.is_enabled
                        || !blending.factors.iter().any(is_second)
                        || executable.has_second_output,
                    "the shader has no second source for blending",
                )?;
            }
        }
        let blends_two = self
            .blending
            .iter()
            .any(|it| it.factors.iter().any(is_second));
        check_state(
            !blends_two
                || framebuffer.draw_buffers.get() >> self.limits.shaders.dual_source_draw_buffers
                    == 0,
            "blending with two sources allows fewer draw buffers",
        )
    }

    fn prepare_textures(&mut self, executable: &Executable) -> Result {
        executable.check_units()?;
        let attachments = if self.framebuffers[DRAW].is_default() {
            Vec::new()
        } else {
            self.framebuffers[DRAW].all()
        };
        for &(at, kind) in &executable.samplers {
            let (unit, Some((slot, component, is_shadow))) =
                (executable.values.borrow()[at] as usize, sampled_by(kind))
            else {
                continue;
            };
            let mut texture = self.units[unit].textures[slot].clone();
            if let Some(it) = &texture {
                let sampling = self.units[unit]
                    .sampler
                    .as_ref()
                    .map_or(&it.sampling, |it| &it.sampling)
                    .get();
                check_state(
                    it.is_for(component, is_shadow, &sampling),
                    "a sampler cannot read the format of its texture",
                )?;
                if let Some([first, last]) = it.sampled_levels(&sampling, self.features) {
                    let is_read = |attachment: &Attachment| matches!(attachment, Attachment::Texture(_, place, _) if attachment.is_of_texture(it) && (first..=last).contains(&place.level));
                    check_state(
                        !attachments.iter().any(is_read),
                        "a texture is read and drawn on at once",
                    )?;
                    self.initialize_texture(it)?;
                } else {
                    texture = None;
                }
            }
            self.bind_natively(unit, slot, texture.as_deref());
        }
        Ok(())
    }

    fn prepare_vertices(&mut self, executable: &Executable) -> Result {
        let (array, plan) = (&*self.vertex_array, &mut self.plan);
        let (attributes, enabled, mut read) = (array.attributes.borrow(), array.enabled.get(), 0);
        (plan.vertices, plan.instances, plan.has_attribute_per_vertex) =
            (u64::MAX, u64::MAX, executable.inputs.is_empty());
        for &(location, wanted) in &executable.inputs {
            let it = &attributes[location];
            plan.has_attribute_per_vertex |= it.divisor == 0;
            if enabled >> location & 1 == 0 {
                check_state(
                    self.generic_attributes[location].0 == wanted,
                    "the constant value of an attribute has another type than in the shader",
                )?;
                continue;
            }
            let given = if !it.is_integer {
                scalar::FLOAT
            } else if matches!(it.kind, BYTE | SHORT | INT) {
                scalar::INT
            } else {
                scalar::UINT
            };
            check_state(
                given == wanted,
                "the array of an attribute has another type than in the shader",
            )?;
            let Some(buffer) = &it.buffer else {
                return bad_state("an enabled array has no buffer");
            };
            let stride = u64::from(if it.stride > 0 { it.stride } else { it.bytes });
            let count = buffer
                .size
                .get()
                .checked_sub(it.offset as u64 + u64::from(it.bytes))
                .map_or(0, |it| it / stride + 1);
            match it.divisor {
                0 => plan.vertices = plan.vertices.min(count),
                divisor => plan.instances = plan.instances.min(count * u64::from(divisor)),
            }
            read |= 1 << location;
        }
        let with_buffer = (0..).zip(&*attributes).fold(0, |all, (index, it)| {
            all | u32::from(it.buffer.is_some()) << index
        });
        check_state(
            enabled & !with_buffer == 0,
            "an enabled array has no buffer",
        )?;
        let mut changed = array.natively_enabled.replace(read) ^ read;
        while let index = changed.trailing_zeros()
            && index < 32
        {
            if read >> index & 1 != 0 {
                self.gl.enable_vertex_attrib_array(index)
            } else {
                self.gl.disable_vertex_attrib_array(index)
            }
            changed &= changed - 1;
        }
        let is_contested = executable
            .inputs
            .iter()
            .filter(|it| read >> it.0 & 1 != 0)
            .filter_map(|it| attributes[it.0].buffer.as_ref())
            .any(|it| self.is_contested(it));
        check_state(
            !is_contested,
            "transform feedback has the buffer of an attribute",
        )
    }

    fn check_blocks(&self, executable: &Executable) -> Result {
        executable
            .linked
            .blocks
            .iter()
            .zip(&executable.bindings)
            .try_for_each(|(block, (_, binding))| {
                let range = self.uniform_buffers[binding.get() as usize].as_ref();
                check_state(
                    range.is_some_and(|it| {
                        it.available() >= block.size.into() && !self.is_contested(&it.buffer)
                    }),
                    "a uniform block has no buffer that is large enough and free",
                )?;
                range.inspect(|it| it.bind(self.gl, UNIFORM_BUFFER, binding.get()));
                Ok(())
            })
    }

    #[cold]
    fn prepare(&mut self) -> Result {
        let Some(executable) = self.executable.clone() else {
            return bad_state("there is no linked program to draw with");
        };
        self.prepare_target()?;
        type Step = fn(&mut Context, &Executable) -> Result;
        let steps: [(u8, Step); 4] = [
            (dirty::OUTPUTS, |it, executable| {
                it.check_outputs(executable)
            }),
            (dirty::TEXTURES, Context::prepare_textures),
            (dirty::VERTICES, Context::prepare_vertices),
            (dirty::BLOCKS, |it, executable| it.check_blocks(executable)),
        ];
        for (bit, step) in steps {
            if self.dirty & bit != 0 {
                step(self, &executable)?;
                self.dirty &= !bit;
            }
        }
        Ok(())
    }

    fn check_draw(&mut self, mode: u32, count: i32, instances: i32) -> Result {
        check_enum(mode <= TRIANGLE_FAN, "unknown mode")?;
        check_value(count >= 0 && instances >= 0, "negative count")?;
        if self.dirty != 0 {
            self.prepare()?;
        }
        check_state(
            self.plan.has_attribute_per_vertex || self.is_webgl2(),
            "one array at least needs the divisor 0",
        )
    }

    fn check_range(&self, vertices: u64, instances: i32) -> Result {
        check_state(
            vertices <= self.plan.vertices && instances as u64 <= self.plan.instances,
            "a vertex is outside of its buffer",
        )
    }

    fn capture(&self, mode: u32, count: i32, instances: i32) -> Result {
        let is_contested = self
            .feedback
            .capture
            .borrow()
            .iter()
            .flat_map(|it| &it.targets)
            .any(|it| self.is_contested(&it.0.buffer));
        let mut capture = self.feedback.capture.borrow_mut();
        let Some(capture) = capture.as_mut().filter(|it| !it.is_paused) else {
            return check_effort(count, instances);
        };
        let per_primitive = [1, 2, 0, 0, 3][capture.mode as usize];
        let vertices =
            capture.vertices + count as u64 / per_primitive * per_primitive * instances as u64;
        check_state(
            mode == capture.mode && !is_contested,
            "transform feedback began with another mode, or its buffers are used otherwise",
        )?;
        check_state(
            capture
                .targets
                .iter()
                .all(|(range, size)| vertices.saturating_mul(*size) <= range.available()),
            "the captured vertices do not fit",
        )?;
        check_effort(count, instances)?;
        capture.vertices = vertices;
        Ok(())
    }

    pub fn draw_arrays(&mut self, mode: u32, first: i32, count: i32) -> Result {
        self.draw_arrays_instanced(mode, first, count, 1)
    }

    pub fn draw_arrays_instanced(
        &mut self,
        mode: u32,
        first: i32,
        count: i32,
        instances: i32,
    ) -> Result {
        check_value(first >= 0, "negative first")?;
        self.check_draw(mode, count, instances)?;
        check_state(
            first.checked_add(count - 1).is_some(),
            "first plus count is too large",
        )?;
        if count > 0 && instances > 0 {
            self.check_range(first as u64 + count as u64, instances)?;
            self.capture(mode, count, instances)?;
            // SAFETY: the buffers have all that it reads, and room for all that it writes.
            unsafe {
                (self.gl.draw_arrays_instanced)(mode, first as u32, count as u32, instances as u32)
            };
        }
        Ok(())
    }

    pub fn draw_elements(&mut self, mode: u32, count: i32, kind: u32, offset: usize) -> Result {
        self.draw_elements_instanced(mode, count, kind, offset, 1)
    }

    pub fn draw_range_elements(
        &mut self,
        mode: u32,
        start: u32,
        end: u32,
        count: i32,
        kind: u32,
        offset: usize,
    ) -> Result {
        check_value(start <= end, "end is before start")?;
        self.draw_elements_instanced(mode, count, kind, offset, 1)
    }

    pub fn draw_elements_instanced(
        &mut self,
        mode: u32,
        count: i32,
        kind: u32,
        offset: usize,
        instances: i32,
    ) -> Result {
        let size = match kind {
            UNSIGNED_BYTE => 1,
            UNSIGNED_SHORT => 2,
            UNSIGNED_INT if self.features.is_webgl2_or_has(Extension::ElementIndexUint) => 4,
            _ => return bad_enum("unknown type"),
        };
        self.check_draw(mode, count, instances)?;
        check_state(
            offset.is_multiple_of(size) && !self.feedback.is_capturing(),
            "the offset is not aligned, or transform feedback is capturing",
        )?;
        let elements = self.vertex_array.elements.borrow();
        let Some(elements) = &*elements else {
            return bad_state("there are no indices");
        };
        if count > 0 && instances > 0 {
            check_state(
                elements.contains(offset, count as u64 * size as u64),
                "an index is outside of its buffer",
            )?;
            let needed = if self.plan.vertices == u64::MAX {
                0
            } else {
                elements.vertices_for(offset as u32, count as u32, kind, self.is_webgl2())
            };
            self.check_range(needed.into(), instances)?;
            check_effort(count, instances)?;
            // SAFETY: the buffers have all that it reads.
            unsafe {
                (self.gl.draw_elements_instanced)(
                    mode,
                    count as u32,
                    kind,
                    offset,
                    instances as u32,
                )
            };
        }
        Ok(())
    }

    /// One instance each if that list is empty.
    pub fn multi_draw(
        &mut self,
        mode: u32,
        has_elements: bool,
        kind: u32,
        starts: &[u32],
        counts: &[u32],
        instances: &[u32],
    ) -> Result {
        self.check_draw(mode, 0, 0)?;
        let draw_id = self.executable.as_ref().and_then(|it| it.draw_id);
        let result =
            (0..)
                .zip(starts.iter().zip(counts))
                .try_for_each(|(index, (&start, &count))| {
                    let instances = instances.get(index as usize).map_or(1, |it| *it as i32);
                    draw_id.inspect(|it| self.gl.uniform_vectors(*it, scalar::INT, 1, &[index]));
                    check_value(start as i32 >= 0, "negative first or offset")?;
                    if has_elements {
                        self.draw_elements_instanced(
                            mode,
                            count as i32,
                            kind,
                            start as usize,
                            instances,
                        )
                    } else {
                        self.draw_arrays_instanced(mode, start as i32, count as i32, instances)
                    }
                });
        draw_id.inspect(|it| self.gl.uniform_vectors(*it, scalar::INT, 1, &[0]));
        result
    }
}
