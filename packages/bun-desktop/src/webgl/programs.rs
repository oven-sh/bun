//! Shaders, programs and uniforms.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use super::context::{Context, MAX_COLORS, dirty};
use super::decoder::{
    Answer, NO_MEMORY, Result, bad_enum, bad_state, bad_value, check_enum, check_state, check_value,
};
use super::formats::Component;
use super::gl::*;
use super::glsl::{self, Active, Linked, Stage};
use super::native;
use super::objects::{Bytes, Handle, is};
use crate::abi_webgl::{answer, scalar};

pub struct Shader {
    pub handle: Handle,
    stage: Stage,
    source: RefCell<String>,
    /// Or the log.
    compiled: RefCell<std::result::Result<glsl::Shader, String>>,
    /// Of both.
    bytes: [Bytes; 2],
}

impl Shader {
    pub fn new(handle: Handle, kind: u32, _: &Context) -> Shader {
        handle.was_bound.set(true);
        Shader {
            handle,
            stage: if kind == VERTEX_SHADER {
                Stage::Vertex
            } else {
                Stage::Fragment
            },
            source: RefCell::default(),
            compiled: Err(String::new()).into(),
            bytes: Default::default(),
        }
    }
}

#[derive(Clone, Copy)]
struct Shape {
    scalar: u32,
    columns: u32,
    rows: u32,
    is_boolean: bool,
    is_sampler: bool,
}

impl Shape {
    fn of(kind: u32) -> Shape {
        let (scalar, columns, rows) = match kind {
            FLOAT => (scalar::FLOAT, 1, 1),
            FLOAT_VEC2..=FLOAT_VEC4 => (scalar::FLOAT, 1, kind - FLOAT_VEC2 + 2),
            INT_VEC2..=INT_VEC4 => (scalar::INT, 1, kind - INT_VEC2 + 2),
            BOOL..=BOOL_VEC4 => (scalar::INT, 1, kind - BOOL + 1),
            UNSIGNED_INT => (scalar::UINT, 1, 1),
            UNSIGNED_INT_VEC2..=UNSIGNED_INT_VEC4 => {
                (scalar::UINT, 1, kind - UNSIGNED_INT_VEC2 + 2)
            }
            FLOAT_MAT2..=FLOAT_MAT4 => {
                (scalar::FLOAT, kind - FLOAT_MAT2 + 2, kind - FLOAT_MAT2 + 2)
            }
            FLOAT_MAT2X3..=FLOAT_MAT4X3 => (
                scalar::FLOAT,
                (kind - FLOAT_MAT2X3) / 2 + 2,
                [3, 4, 2, 4, 2, 3][(kind - FLOAT_MAT2X3) as usize],
            ),
            _ => (scalar::INT, 1, 1),
        };
        Shape {
            scalar,
            columns,
            rows,
            is_boolean: (BOOL..=BOOL_VEC4).contains(&kind),
            is_sampler: sampled_by(kind).is_some(),
        }
    }

    fn words(self) -> usize {
        (self.columns * self.rows) as usize
    }
}

/// The place in `textures::TARGETS`, what it returns, and whether it compares.
pub fn sampled_by(kind: u32) -> Option<(usize, Component, bool)> {
    Some(match kind {
        SAMPLER_2D | SAMPLER_2D_SHADOW => (0, Component::Float, kind == SAMPLER_2D_SHADOW),
        SAMPLER_CUBE | SAMPLER_CUBE_SHADOW => (1, Component::Float, kind == SAMPLER_CUBE_SHADOW),
        SAMPLER_3D => (2, Component::Float, false),
        SAMPLER_2D_ARRAY | SAMPLER_2D_ARRAY_SHADOW => {
            (3, Component::Float, kind == SAMPLER_2D_ARRAY_SHADOW)
        }
        INT_SAMPLER_2D..=INT_SAMPLER_CUBE => (
            [0, 2, 1][(kind - INT_SAMPLER_2D) as usize],
            Component::Int,
            false,
        ),
        UNSIGNED_INT_SAMPLER_2D..=UNSIGNED_INT_SAMPLER_CUBE => (
            [0, 2, 1][(kind - UNSIGNED_INT_SAMPLER_2D) as usize],
            Component::Uint,
            false,
        ),
        INT_SAMPLER_2D_ARRAY => (3, Component::Int, false),
        UNSIGNED_INT_SAMPLER_2D_ARRAY => (3, Component::Uint, false),
        _ => return None,
    })
}

/// An element of a uniform.
struct Location {
    shape: Shape,
    uniform: usize,
    element: u32,
    /// In `Executable::values`.
    start: usize,
    native: Cell<Option<i32>>,
}

/// The result of linking.
pub struct Executable {
    pub name: u32,
    pub linked: Linked,
    /// What the page knows the first of them as.
    first_location: u32,
    locations: Vec<Location>,
    pub values: RefCell<Vec<u32>>,
    /// Where the unit is in `values`, and the type.
    pub samplers: Vec<(usize, u32)>,
    /// Location and scalar.
    pub inputs: Vec<(usize, u32)>,
    pub outputs: [Option<u32>; MAX_COLORS],
    pub has_second_output: bool,
    /// For each block, what the driver calls it and where its buffer is bound.
    pub bindings: Vec<(u32, Cell<u32>)>,
    /// For each buffer, of a vertex.
    pub captured_bytes: Vec<u64>,
    is_feedback_separate: bool,
    pub draw_id: Option<i32>,
    _bytes: Bytes,
}

impl Drop for Executable {
    fn drop(&mut self) {
        native::gl().delete_program(self.name);
    }
}

pub struct Program {
    pub handle: Handle,
    shaders: RefCell<[Option<Rc<Shader>>; 2]>,
    attribute_locations: RefCell<HashMap<String, u32>>,
    /// And whether each goes to a buffer of its own.
    feedback: RefCell<(Vec<String>, bool)>,
    /// Or the log.
    linked: RefCell<std::result::Result<Rc<Executable>, String>>,
    is_validated: Cell<bool>,
    /// By how many transform feedback objects it is used.
    pub captures: Cell<u32>,
}

impl Program {
    pub fn new(handle: Handle, _: u32, _: &Context) -> Program {
        handle.was_bound.set(true);
        let (shaders, attribute_locations, feedback, is_validated, captures) = Default::default();
        Program {
            handle,
            shaders,
            attribute_locations,
            feedback,
            linked: Err(String::new()).into(),
            is_validated,
            captures,
        }
    }

    pub fn executable(&self) -> Option<Rc<Executable>> {
        self.linked.borrow().as_ref().ok().cloned()
    }

    fn require_linked(&self) -> Result<Rc<Executable>> {
        self.executable()
            .map_or(bad_state("the program is not linked"), Ok)
    }
}

/// The index of what has that name, and that of the element.
fn find(all: &[Active], name: &str) -> Option<(usize, u32)> {
    let subscript = name
        .strip_suffix(']')
        .and_then(|it| it.rsplit_once('['))
        .filter(|it| {
            it.1.bytes().all(|it| it.is_ascii_digit())
                && (it.1.len() == 1 || !it.1.starts_with('0'))
        });
    let (base, element) = subscript
        .and_then(|it| Some((it.0, it.1.parse().ok()?)))
        .unwrap_or((name, 0));
    let is_it = |it: &Active| {
        if it.is_array {
            it.name
                .strip_suffix("[0]")
                .is_some_and(|it| it == base || it == name)
                && element < it.size
        } else {
            it.name == name
        }
    };
    all.iter().position(is_it).map(|at| {
        (
            at,
            if all[at].is_array && all[at].name.len() != name.len() + 3 {
                element
            } else {
                0
            },
        )
    })
}

fn is_reserved(name: &str) -> bool {
    name.starts_with("webgl_") || name.starts_with("_webgl_")
}

fn info(all: &[Active], index: u32) -> Result<Answer> {
    all.get(index as usize)
        .map_or(bad_value("the index is too large"), |it| {
            Ok(Answer::ActiveInfo(it.size, it.kind, it.name.clone()))
        })
}

impl Context {
    fn check_name(&self, name: &str) -> Result {
        let is_valid = |it: u8| {
            matches!(it, 9..=13 | 32..=126)
                && !matches!(it, b'"' | b'$' | b'\'' | b'@' | b'\\' | b'`')
        };
        check_value(
            name.len() <= glsl::longest_identifier(self.is_webgl2()) && name.bytes().all(is_valid),
            "the name is too long, or has characters that GLSL lacks",
        )
    }

    pub fn shader_source(&mut self, shader: Rc<Shader>, source: &str) -> Result {
        const MAX_LENGTH: usize = 1 << 23;
        if source.len() > MAX_LENGTH {
            Err(NO_MEMORY)
        } else {
            shader.bytes[0].set(source.len() as u64)
        }?;
        shader.source.replace(source.into());
        Ok(())
    }

    pub fn compile_shader(&mut self, shader: Rc<Shader>) {
        let options = glsl::Options {
            is_webgl2: self.is_webgl2(),
            extensions: self.shader_extensions(),
            limits: &self.limits.shaders,
        };
        let compiled = glsl::compile(shader.stage, &shader.source.borrow(), &options);
        let fits = shader.bytes[1]
            .set(compiled.as_ref().map_or(0, glsl::Shader::bytes))
            .map_err(|it| it.1.into());
        *shader.compiled.borrow_mut() = fits.and(compiled);
    }

    pub fn get_shader_source(&mut self, shader: Rc<Shader>) -> Answer {
        Answer::Text(shader.source.borrow().clone())
    }

    pub fn get_translated_shader_source(&mut self, shader: Rc<Shader>) -> Answer {
        Answer::Text(
            shader
                .compiled
                .borrow()
                .as_ref()
                .map_or_else(|_| String::new(), glsl::translate),
        )
    }

    pub fn get_shader_info_log(&mut self, shader: Rc<Shader>) -> Answer {
        Answer::Text(
            shader
                .compiled
                .borrow()
                .as_ref()
                .err()
                .cloned()
                .unwrap_or_default(),
        )
    }

    pub fn get_shader_parameter(&mut self, shader: Rc<Shader>, name: u32) -> Result<Answer> {
        Ok(match name {
            DELETE_STATUS => Answer::Boolean(shader.handle.is_deleted.get()),
            COMPILE_STATUS => Answer::Boolean(shader.compiled.borrow().is_ok()),
            SHADER_TYPE => Answer::Uint(if shader.stage == Stage::Vertex {
                VERTEX_SHADER
            } else {
                FRAGMENT_SHADER
            }),
            _ => return bad_enum("unknown pname"),
        })
    }

    pub fn get_shader_precision_format(&mut self, shader: u32, precision: u32) -> Result<Answer> {
        check_enum(
            matches!(shader, VERTEX_SHADER | FRAGMENT_SHADER)
                && (LOW_FLOAT..=HIGH_INT).contains(&precision),
            "unknown shadertype or precisiontype",
        )?;
        Ok(Answer::List(
            answer::PRECISION_FORMAT,
            if precision <= HIGH_FLOAT {
                vec![127, 127, 23]
            } else {
                vec![31, 30, 0]
            },
        ))
    }

    pub fn attach_shader(&mut self, program: Rc<Program>, shader: Rc<Shader>) -> Result {
        let slot = &mut program.shaders.borrow_mut()[shader.stage as usize];
        check_state(slot.is_none(), "the program has a shader for this stage")?;
        *slot = Some(shader);
        Ok(())
    }

    pub fn detach_shader(&mut self, program: Rc<Program>, shader: Rc<Shader>) -> Result {
        check_state(
            program.shaders.borrow_mut()[shader.stage as usize]
                .take_if(|it| Rc::ptr_eq(it, &shader))
                .is_some(),
            "the program does not have this shader",
        )
    }

    pub fn get_attached_shaders(&mut self, program: Rc<Program>) -> Answer {
        Answer::List(
            answer::OBJECTS,
            program
                .shaders
                .borrow()
                .iter()
                .flatten()
                .map(|it| it.handle.id)
                .collect(),
        )
    }

    pub fn bind_attrib_location(&mut self, program: Rc<Program>, index: u32, name: &str) -> Result {
        self.check_name(name)?;
        check_state(
            !is_reserved(name) && !name.starts_with("gl_"),
            "the prefix is reserved",
        )?;
        check_value(
            index < self.limits.shaders.vertex_attributes,
            "the index is too large",
        )?;
        program
            .attribute_locations
            .borrow_mut()
            .insert(name.into(), index);
        Ok(())
    }

    /// Each name ends with a null character.
    pub fn transform_feedback_varyings(
        &mut self,
        program: Rc<Program>,
        mode: u32,
        names: &str,
    ) -> Result {
        check_enum(
            matches!(mode, SEPARATE_ATTRIBS | INTERLEAVED_ATTRIBS),
            "unknown bufferMode",
        )?;
        let names: Vec<_> = names.split_terminator('\0').map(String::from).collect();
        check_value(
            mode == INTERLEAVED_ATTRIBS
                || names.len() <= self.limits.shaders.separate_feedback_attributes as usize,
            "more varyings than MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS",
        )?;
        program.feedback.replace((names, mode == SEPARATE_ATTRIBS));
        Ok(())
    }

    fn link(&mut self, program: &Program) -> std::result::Result<Rc<Executable>, String> {
        let shaders = program.shaders.borrow();
        let [Some(vertex), Some(fragment)] = &*shaders else {
            return Err("A stage has no shader\n".into());
        };
        let (vertex, fragment, (feedback, is_feedback_separate)) = (
            vertex.compiled.borrow(),
            fragment.compiled.borrow(),
            &*program.feedback.borrow(),
        );
        let (Ok(vertex), Ok(fragment)) = (&*vertex, &*fragment) else {
            return Err("A shader was not compiled\n".into());
        };
        let (attribute_locations, is_feedback_separate, gl) = (
            &*program.attribute_locations.borrow(),
            *is_feedback_separate,
            self.gl,
        );
        let mut linked = glsl::link(&glsl::Request {
            shaders: [vertex, fragment],
            attribute_locations,
            feedback,
            is_feedback_separate,
            limits: &self.limits.shaders,
        })?;
        let bytes = Bytes::default();
        bytes
            .set(
                linked
                    .uniforms
                    .iter()
                    .map(|it| it.name.len() + size_of_val(it))
                    .chain(linked.sources.iter().map(String::len))
                    .sum::<usize>() as u64,
            )
            .map_err(|it| it.1)?;
        let name = self.without_feedback(|| {
            gl.build(
                &linked,
                if is_feedback_separate {
                    SEPARATE_ATTRIBS
                } else {
                    INTERLEAVED_ATTRIBS
                },
            )
        })?;
        linked.sources = Default::default();
        let (mut locations, mut samplers, mut words, mut outputs) =
            (Vec::new(), Vec::new(), 0, [None; MAX_COLORS]);
        for (uniform, it) in linked
            .uniforms
            .iter()
            .enumerate()
            .filter(|it| it.1.block.is_none())
        {
            for element in 0..it.size {
                let shape = Shape::of(it.kind);
                samplers.extend(shape.is_sampler.then_some((words, it.kind)));
                locations.push(Location {
                    shape,
                    uniform,
                    element,
                    start: words,
                    native: None.into(),
                });
                words += shape.words();
            }
        }
        let columns = |it: &Active| Some((it.location? as usize, Shape::of(it.kind)));
        let inputs = linked
            .attributes
            .iter()
            .filter_map(columns)
            .flat_map(|(first, shape)| {
                (first..first + shape.columns as usize).map(move |it| (it, shape.scalar))
            })
            .collect();
        for it in linked.outputs.iter().filter(|it| it.index == 0) {
            outputs[it.location.unwrap_or(0) as usize..][..it.size as usize]
                .fill(Some(Shape::of(it.kind).scalar));
        }
        let bindings: Vec<_> = linked
            .blocks
            .iter()
            .map(|it| (gl.uniform_block_index(name, &it.native_name), Cell::new(0)))
            .collect();
        bindings
            .iter()
            .filter(|it| it.0 != INVALID_INDEX)
            .for_each(|it| gl.uniform_block_binding(name, it.0, 0));
        let sizes = linked
            .feedback
            .iter()
            .map(|it| Shape::of(it.kind).words() as u64 * u64::from(it.size) * 4);
        let first_location = self.locations;
        self.locations = first_location.wrapping_add(locations.len() as u32);
        Ok(Rc::new(Executable {
            name,
            first_location,
            locations,
            values: vec![0; words].into(),
            samplers,
            inputs,
            outputs,
            has_second_output: linked.outputs.iter().any(|it| it.index == 1),
            bindings,
            captured_bytes: if is_feedback_separate || feedback.is_empty() {
                sizes.collect()
            } else {
                vec![sizes.sum()]
            },
            is_feedback_separate,
            draw_id: linked.draw_id.map(|it| gl.uniform_location(name, it)),
            linked,
            _bytes: bytes,
        }))
    }

    pub fn link_program(&mut self, program: Rc<Program>) -> Result {
        check_state(
            program.captures.get() == 0,
            "transform feedback began with the program",
        )?;
        *program.linked.borrow_mut() = self.link(&program);
        if is(&self.program, &program) {
            self.install();
        }
        Ok(())
    }

    fn install(&mut self) {
        self.executable = self.program.as_ref().and_then(|it| it.executable());
        self.gl
            .use_program(self.executable.as_ref().map_or(0, |it| it.name));
        self.dirty |= dirty::ALL & !dirty::FRAMEBUFFER;
    }

    pub fn use_program(&mut self, program: Option<Rc<Program>>) -> Result {
        check_state(
            program.as_ref().is_none_or(|it| it.linked.borrow().is_ok()),
            "linking the program has failed",
        )?;
        check_state(
            !self.feedback.is_capturing(),
            "not while transform feedback is capturing",
        )?;
        if program.as_ref().is_none_or(|it| !is(&self.program, it)) {
            self.program = program;
            self.install();
        }
        Ok(())
    }

    pub fn validate_program(&mut self, program: Rc<Program>) {
        program.is_validated.set(
            program
                .executable()
                .is_some_and(|it| it.check_units().is_ok()),
        );
    }

    pub fn get_program_info_log(&mut self, program: Rc<Program>) -> Answer {
        Answer::Text(
            program
                .linked
                .borrow()
                .as_ref()
                .err()
                .cloned()
                .unwrap_or_default(),
        )
    }

    pub fn get_program_parameter(&mut self, program: Rc<Program>, name: u32) -> Result<Answer> {
        let executable = program.executable();
        let count = |of: fn(&Linked) -> usize| {
            Answer::Uint(executable.as_ref().map_or(0, |it| of(&it.linked) as u32))
        };
        Ok(match name {
            DELETE_STATUS => Answer::Boolean(program.handle.is_deleted.get()),
            VALIDATE_STATUS => Answer::Boolean(program.is_validated.get()),
            LINK_STATUS => Answer::Boolean(executable.is_some()),
            ATTACHED_SHADERS => {
                Answer::Uint(program.shaders.borrow().iter().flatten().count() as u32)
            }
            ACTIVE_ATTRIBUTES => count(|it| it.attributes.len()),
            ACTIVE_UNIFORMS => count(|it| it.uniforms.len()),
            ACTIVE_UNIFORM_BLOCKS if self.is_webgl2() => count(|it| it.blocks.len()),
            TRANSFORM_FEEDBACK_VARYINGS if self.is_webgl2() => count(|it| it.feedback.len()),
            TRANSFORM_FEEDBACK_BUFFER_MODE if self.is_webgl2() => {
                Answer::Uint(if executable.is_some_and(|it| it.is_feedback_separate) {
                    SEPARATE_ATTRIBS
                } else {
                    INTERLEAVED_ATTRIBS
                })
            }
            _ => return bad_enum("unknown pname"),
        })
    }

    pub fn get_active_attrib(&mut self, program: Rc<Program>, index: u32) -> Result<Answer> {
        info(
            program
                .executable()
                .as_ref()
                .map_or(&[], |it| &it.linked.attributes),
            index,
        )
    }

    pub fn get_active_uniform(&mut self, program: Rc<Program>, index: u32) -> Result<Answer> {
        info(
            program
                .executable()
                .as_ref()
                .map_or(&[], |it| &it.linked.uniforms),
            index,
        )
    }

    pub fn get_transform_feedback_varying(
        &mut self,
        program: Rc<Program>,
        index: u32,
    ) -> Result<Answer> {
        info(&program.require_linked()?.linked.feedback, index)
    }

    fn location_in(
        &self,
        program: &Program,
        name: &str,
        all: fn(&Linked) -> &[Active],
    ) -> Result<Answer> {
        self.check_name(name)?;
        let executable = program.require_linked()?;
        let (all, is_builtin) = (all(&executable.linked), name.starts_with("gl_"));
        Ok(Answer::Int(
            find(all, name)
                .filter(|_| !is_builtin)
                .and_then(|(at, element)| Some(all[at].location? + element))
                .map_or(-1, |it| it as i32),
        ))
    }

    pub fn get_attrib_location(&mut self, program: Rc<Program>, name: &str) -> Result<Answer> {
        self.location_in(&program, name, |it| &it.attributes)
    }

    pub fn get_frag_data_location(&mut self, program: Rc<Program>, name: &str) -> Result<Answer> {
        self.location_in(&program, name, |it| &it.outputs)
    }

    pub fn get_uniform_location(&mut self, program: Rc<Program>, name: &str) -> Result<Answer> {
        self.check_name(name)?;
        let executable = program.require_linked()?;
        let at = find(&executable.linked.uniforms, name)
            .filter(|_| !name.starts_with("gl_"))
            .and_then(|wanted| {
                executable
                    .locations
                    .binary_search_by_key(&wanted, |it| (it.uniform, it.element))
                    .ok()
            });
        Ok(at.map_or(Answer::Object(0), |it| {
            Answer::Location(executable.first_location.wrapping_add(it as u32))
        }))
    }

    pub fn get_uniform(&mut self, program: Rc<Program>, location: u32) -> Result<Answer> {
        let executable = program.require_linked()?;
        let Location { shape, start, .. } = *executable.location(location)?;
        let values = &executable.values.borrow()[start..][..shape.words()];
        Ok(match (values, shape.scalar) {
            ([value], _) if shape.is_boolean => Answer::Boolean(*value != 0),
            ([value], scalar::FLOAT) => Answer::Float(f32::from_bits(*value)),
            ([value], scalar::INT) => Answer::Int(*value as i32),
            ([value], _) => Answer::Uint(*value),
            _ if shape.is_boolean => Answer::List(answer::BOOLEANS, values.into()),
            _ => Answer::List(
                [answer::FLOAT_ARRAY, answer::INT_ARRAY, answer::UINT_ARRAY][shape.scalar as usize],
                values.into(),
            ),
        })
    }

    /// `shape` has a byte each for the scalar, the rows, the columns, and whether to transpose.
    pub fn uniform(&mut self, location: u32, shape: u32, values: &[u32]) -> Result {
        let Some(executable) = &self.executable else {
            return bad_state("the location is from another program");
        };
        let (it, [scalar, rows, columns, transposes]) = (
            executable.location(location)?,
            shape.to_le_bytes().map(u32::from),
        );
        let (uniform, words) = (&executable.linked.uniforms[it.uniform], it.shape.words());
        check_value(
            transposes == 0 || self.is_webgl2(),
            "WebGL 1 does not transpose",
        )?;
        check_value(
            !values.is_empty() && values.len().is_multiple_of((rows * columns) as usize),
            "the number of values does not fit the type",
        )?;
        check_state(
            [rows, columns] == [it.shape.rows, it.shape.columns]
                && (scalar == it.shape.scalar || it.shape.is_boolean),
            "the uniform has another type",
        )?;
        check_state(
            uniform.is_array || values.len() == words,
            "there are too many values for what is no array",
        )?;
        let values = &values[..values
            .len()
            .min((uniform.size - it.element) as usize * words)];
        check_value(
            !it.shape.is_sampler
                || values
                    .iter()
                    .all(|it| *it < self.limits.shaders.combined_texture_units),
            "there is no such texture unit",
        )?;
        let stored = &mut executable.values.borrow_mut()[it.start..][..values.len()];
        if it.shape.is_boolean {
            stored.iter_mut().zip(values).for_each(|(to, it)| {
                *to = (if scalar == scalar::FLOAT {
                    f32::from_bits(*it) != 0.
                } else {
                    *it != 0
                })
                .into()
            });
        } else if transposes != 0 {
            let (rows, columns) = (rows as usize, columns as usize);
            stored.iter_mut().enumerate().for_each(|(at, to)| {
                *to = values[at / words * words + at % rows * columns + at % words / rows]
            });
        } else if stored == values {
            return Ok(());
        } else {
            stored.copy_from_slice(values);
        }
        let native = it.native.get().unwrap_or_else(|| {
            let name = if uniform.is_array {
                &format!("{}[{}]", uniform.native_name, it.element)
            } else {
                &uniform.native_name
            };
            self.gl.uniform_location(executable.name, name)
        });
        it.native.set(Some(native));
        if columns > 1 {
            self.gl.uniform_matrices(native, columns, rows, stored)
        } else {
            self.gl
                .uniform_vectors(native, it.shape.scalar, rows, stored)
        }
        if it.shape.is_sampler {
            self.dirty |= dirty::TEXTURES;
        }
        Ok(())
    }

    /// Each name ends with a null character.
    pub fn get_uniform_indices(&mut self, program: Rc<Program>, names: &str) -> Answer {
        let executable = program.executable();
        let index = |name| {
            find(&executable.as_ref()?.linked.uniforms, name)
                .filter(|it| it.1 == 0)
                .map(|it| it.0 as u32)
        };
        Answer::List(
            answer::UINTS,
            names
                .split_terminator('\0')
                .map(|it| index(it).unwrap_or(INVALID_INDEX))
                .collect(),
        )
    }

    pub fn get_active_uniforms(
        &mut self,
        program: Rc<Program>,
        name: u32,
        indices: &[u32],
    ) -> Result<Answer> {
        let get: fn(&Active) -> u32 = match name {
            UNIFORM_TYPE => |it| it.kind,
            UNIFORM_SIZE => |it| it.size,
            UNIFORM_BLOCK_INDEX => |it| it.block.unwrap_or(!0),
            UNIFORM_OFFSET => |it| it.block.map_or(!0, |_| it.offset),
            UNIFORM_ARRAY_STRIDE => |it| it.block.map_or(!0, |_| it.array_stride),
            UNIFORM_MATRIX_STRIDE => |it| it.block.map_or(!0, |_| it.matrix_stride),
            UNIFORM_IS_ROW_MAJOR => |it| it.is_row_major.into(),
            _ => return bad_enum("unknown pname"),
        };
        let executable = program.executable();
        let values = indices
            .iter()
            .map(|it| {
                executable
                    .as_ref()?
                    .linked
                    .uniforms
                    .get(*it as usize)
                    .map(get)
            })
            .collect::<Option<_>>();
        values.map_or(bad_value("there is no such uniform"), |it| {
            Ok(Answer::List(
                if name == UNIFORM_IS_ROW_MAJOR {
                    answer::BOOLEANS
                } else {
                    answer::INTS
                },
                it,
            ))
        })
    }

    pub fn get_uniform_block_index(&mut self, program: Rc<Program>, name: &str) -> Result<Answer> {
        self.check_name(name)?;
        let index = program.executable().and_then(|it| {
            it.linked
                .blocks
                .iter()
                .position(|it| it.name == name || it.name.strip_suffix("[0]") == Some(name))
        });
        Ok(Answer::Uint(index.map_or(INVALID_INDEX, |it| it as u32)))
    }

    fn with_block(program: &Program, index: u32) -> Result<Rc<Executable>> {
        let executable = program.require_linked()?;
        check_value(
            (index as usize) < executable.linked.blocks.len(),
            "there is no such block",
        )
        .map(|()| executable)
    }

    pub fn get_active_uniform_block_name(
        &mut self,
        program: Rc<Program>,
        index: u32,
    ) -> Result<Answer> {
        Ok(Answer::Text(
            Context::with_block(&program, index)?.linked.blocks[index as usize]
                .name
                .clone(),
        ))
    }

    pub fn get_active_uniform_block_parameter(
        &mut self,
        program: Rc<Program>,
        index: u32,
        name: u32,
    ) -> Result<Answer> {
        let executable = Context::with_block(&program, index)?;
        let block = &executable.linked.blocks[index as usize];
        Ok(match name {
            UNIFORM_BLOCK_BINDING => Answer::Uint(executable.bindings[index as usize].1.get()),
            UNIFORM_BLOCK_DATA_SIZE => Answer::Uint(block.size),
            UNIFORM_BLOCK_ACTIVE_UNIFORMS => Answer::Uint(block.members.len() as u32),
            UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES => {
                Answer::List(answer::UINT_ARRAY, block.members.clone().collect())
            }
            UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER => Answer::Boolean(block.is_in_stage[0]),
            UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER => Answer::Boolean(block.is_in_stage[1]),
            _ => return bad_enum("unknown pname"),
        })
    }

    pub fn uniform_block_binding(
        &mut self,
        program: Rc<Program>,
        index: u32,
        binding: u32,
    ) -> Result {
        let executable = Context::with_block(&program, index)?;
        check_value(
            binding < self.limits.uniform_bindings,
            "there is no such binding",
        )?;
        let (native, bound) = &executable.bindings[index as usize];
        bound.set(binding);
        if *native != INVALID_INDEX {
            self.gl
                .uniform_block_binding(executable.name, *native, binding);
        }
        self.dirty |= dirty::BLOCKS;
        Ok(())
    }
}

impl Executable {
    fn location(&self, location: u32) -> Result<&Location> {
        self.locations
            .get(location.wrapping_sub(self.first_location) as usize)
            .map_or(bad_state("the location is from another program"), Ok)
    }

    pub fn check_units(&self) -> Result {
        let (values, mut kinds) = (self.values.borrow(), [NONE; 64]);
        let is_consistent = self.samplers.iter().all(|(at, kind)| {
            [NONE, *kind].contains(&std::mem::replace(&mut kinds[values[*at] as usize], *kind))
        });
        check_state(
            is_consistent,
            "samplers of different types share a texture unit",
        )
    }
}
