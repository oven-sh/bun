//! What the thread of the page can answer by itself: it has heard the answer, and it can tell what the commands since have made of it.

use super::decoder::{Command, command_at};
use super::gl::*;
use crate::abi_webgl::answer::{BOOLEAN, BOOLEANS, INT_ARRAY, OBJECT, UINT};
use crate::hash::FastMap;

/// After so many batches of commands without a question, they are not worth reading.
const ATTENTION: u32 = 256;

#[derive(Default)]
pub struct Memo {
    attention: u32,
    /// How many words of the room.
    read: usize,
    /// By `key`.
    parameters: FastMap<u32, Vec<u32>>,
    /// By the question. They hold until a program changes.
    locations: FastMap<Vec<u32>, Vec<u32>>,
    /// For an object, the parameter that it can become the value of.
    fits: FastMap<u32, u32>,
    question: Vec<u32>,
    may_capture: bool,
}

/// About the context, when it has answered.
#[derive(Clone, Copy, Default)]
pub struct Facts {
    pub active_texture: u32,
    pub may_capture: bool,
}

const OF_BLENDING: [u32; 8] = [
    BLEND_SRC_RGB,
    BLEND_DST_RGB,
    BLEND_SRC_ALPHA,
    BLEND_DST_ALPHA,
    BLEND_EQUATION,
    BLEND_EQUATION_ALPHA,
    BLEND,
    COLOR_WRITEMASK,
];

fn is_binding(name: u32) -> bool {
    matches!(
        name,
        ARRAY_BUFFER_BINDING
            | ELEMENT_ARRAY_BUFFER_BINDING
            | CURRENT_PROGRAM
            | FRAMEBUFFER_BINDING
            | READ_FRAMEBUFFER_BINDING
            | RENDERBUFFER_BINDING
            | VERTEX_ARRAY_BINDING
    ) || is_of_unit(name)
}

fn is_of_unit(name: u32) -> bool {
    matches!(
        name,
        TEXTURE_BINDING_2D
            | TEXTURE_BINDING_CUBE_MAP
            | TEXTURE_BINDING_3D
            | TEXTURE_BINDING_2D_ARRAY
    )
}

fn is_capability(name: u32) -> bool {
    matches!(
        name,
        BLEND
            | CULL_FACE
            | DEPTH_TEST
            | DITHER
            | POLYGON_OFFSET_FILL
            | SAMPLE_ALPHA_TO_COVERAGE
            | SAMPLE_COVERAGE
            | SCISSOR_TEST
            | STENCIL_TEST
            | RASTERIZER_DISCARD
    )
}

fn is_followed(name: u32) -> bool {
    let is_limit = matches!(
        name,
        MAX_TEXTURE_SIZE
            | MAX_VIEWPORT_DIMS
            | MAX_RENDERBUFFER_SIZE
            | MAX_VERTEX_ATTRIBS
            | MAX_TEXTURE_IMAGE_UNITS
            | MAX_COMBINED_TEXTURE_IMAGE_UNITS
    );
    is_capability(name)
        || is_limit
        || is_binding(name)
        || OF_BLENDING.contains(&name)
        || matches!(
            name,
            ACTIVE_TEXTURE
                | VIEWPORT
                | SCISSOR_BOX
                | DEPTH_WRITEMASK
                | DEPTH_FUNC
                | CULL_FACE_MODE
                | FRONT_FACE
        )
}

impl Memo {
    fn key(&self, name: u32) -> Option<u32> {
        if is_of_unit(name) {
            Some(self.parameters.get(&ACTIVE_TEXTURE)?[1] << 16 | name)
        } else {
            is_followed(name).then_some(name)
        }
    }

    /// Only a parameter that was heard of is known to exist.
    fn set(&mut self, name: u32, is_certain: bool, answer: &[u32]) {
        let Some(key) = self.key(name) else {
            return self.parameters.retain(|key, _| key & 0xFFFF != name);
        };
        match self.parameters.get_mut(&key) {
            Some(known) if is_certain => known.copy_from_slice(answer),
            Some(_) => drop(self.parameters.remove(&key)),
            None => {}
        }
    }

    fn bind(&mut self, name: u32, object: u32) {
        self.set(
            name,
            object == 0 || self.fits.get(&object) == Some(&name),
            &[OBJECT, object],
        );
    }

    fn set_all(&mut self, names: &[u32], values: &[u32], is_always_valid: fn(u32) -> bool) {
        names.iter().zip(values).for_each(|(name, it)| {
            self.set(
                *name,
                values.iter().all(|it| is_always_valid(*it)),
                &[UINT, *it],
            )
        });
    }

    fn follow(&mut self, op: Command, arguments: &[u32]) {
        let is_factor = |it| matches!(it, ZERO | ONE | SRC_COLOR..=ONE_MINUS_DST_COLOR);
        let is_equation = |it| matches!(it, FUNC_ADD | FUNC_SUBTRACT | FUNC_REVERSE_SUBTRACT);
        match (op, arguments) {
            (Command::ActiveTexture, it) => self.set_all(&[ACTIVE_TEXTURE], it, |it| {
                (TEXTURE0..TEXTURE0 + 16).contains(&it)
            }),
            (Command::BindBuffer, &[ARRAY_BUFFER, it]) => self.bind(ARRAY_BUFFER_BINDING, it),
            (Command::BindBuffer, &[ELEMENT_ARRAY_BUFFER, it]) => {
                self.bind(ELEMENT_ARRAY_BUFFER_BINDING, it)
            }
            (Command::BindFramebuffer, &[target, it]) => {
                let is_certain = target == FRAMEBUFFER
                    && (it == 0 || self.fits.get(&it) == Some(&FRAMEBUFFER_BINDING));
                [FRAMEBUFFER_BINDING, READ_FRAMEBUFFER_BINDING]
                    .into_iter()
                    .for_each(|name| self.set(name, is_certain, &[OBJECT, it]));
            }
            (Command::BindRenderbuffer, &[RENDERBUFFER, it]) => self.bind(RENDERBUFFER_BINDING, it),
            (Command::BindTexture, &[TEXTURE_2D, it]) => self.bind(TEXTURE_BINDING_2D, it),
            (Command::BindTexture, &[TEXTURE_CUBE_MAP, it]) => {
                self.bind(TEXTURE_BINDING_CUBE_MAP, it)
            }
            (Command::BindTexture, &[TEXTURE_3D, it]) => self.bind(TEXTURE_BINDING_3D, it),
            (Command::BindTexture, &[TEXTURE_2D_ARRAY, it]) => {
                self.bind(TEXTURE_BINDING_2D_ARRAY, it)
            }
            (Command::BindVertexArray, &[it]) => {
                self.bind(VERTEX_ARRAY_BINDING, it);
                self.parameters.remove(&ELEMENT_ARRAY_BUFFER_BINDING);
            }
            (Command::BeginTransformFeedback, _) => self.may_capture = true,
            (Command::UseProgram, _) if self.may_capture => {
                drop(self.parameters.remove(&CURRENT_PROGRAM))
            }
            (Command::UseProgram, &[it]) => self.bind(CURRENT_PROGRAM, it),
            (Command::Enable | Command::Disable, &[it]) if is_capability(it) => {
                self.set(it, true, &[BOOLEAN, matches!(op, Command::Enable).into()])
            }
            (Command::Viewport, &[x, y, width, height]) => self.set(
                VIEWPORT,
                width.max(height) <= 4096,
                &[INT_ARRAY, x, y, width, height],
            ),
            (Command::Scissor, &[x, y, width, height]) => self.set(
                SCISSOR_BOX,
                width.max(height) <= 4096,
                &[INT_ARRAY, x, y, width, height],
            ),
            (Command::BlendFunc, &[source, destination]) => self.set_all(
                &OF_BLENDING,
                &[source, destination, source, destination],
                is_factor,
            ),
            (Command::BlendFuncSeparate, it) => self.set_all(&OF_BLENDING, it, is_factor),
            (Command::BlendEquation, &[it]) => {
                self.set_all(&OF_BLENDING[4..], &[it; 2], is_equation)
            }
            (Command::BlendEquationSeparate, it) => {
                self.set_all(&OF_BLENDING[4..], it, is_equation)
            }
            (Command::ColorMask, &[red, green, blue, alpha]) => {
                self.set(COLOR_WRITEMASK, true, &[BOOLEANS, red, green, blue, alpha])
            }
            (Command::DepthMask, &[it]) => self.set(DEPTH_WRITEMASK, true, &[BOOLEAN, it]),
            (Command::DepthFunc, it) => {
                self.set_all(&[DEPTH_FUNC], it, |it| (NEVER..=ALWAYS).contains(&it))
            }
            (Command::CullFace, it) => self.set_all(&[CULL_FACE_MODE], it, |it| {
                matches!(it, FRONT | BACK | FRONT_AND_BACK)
            }),
            (Command::FrontFace, it) => {
                self.set_all(&[FRONT_FACE], it, |it| matches!(it, CW | CCW))
            }
            (
                Command::Enablei
                | Command::Disablei
                | Command::BlendEquationi
                | Command::BlendEquationSeparatei
                | Command::BlendFunci
                | Command::BlendFuncSeparatei
                | Command::ColorMaski,
                _,
            ) => {
                self.parameters
                    .retain(|name, _| !OF_BLENDING.contains(name));
            }
            (Command::Delete, &[_, it]) | (Command::LinkProgram | Command::Release, &[it]) => {
                self.fits.remove(&it);
                self.locations.retain(|question, _| question[1] != it);
                self.parameters.retain(|name, answer| {
                    *answer != [OBJECT, it] && *name != ELEMENT_ARRAY_BUFFER_BINDING
                });
            }
            _ => {}
        }
    }

    fn read(&mut self, written: &[u32]) {
        while let Some((op, arguments)) = written.get(self.read..).and_then(command_at) {
            self.read += 1 + arguments.len();
            self.follow(op, arguments);
        }
    }

    /// All that was written to a room, which is replaced.
    pub fn send(&mut self, written: &[u32]) {
        if self.attention > 0 {
            self.attention -= 1;
            self.read(written);
        }
        self.read = 0;
    }

    /// If it does not know, `question` is what is sent next.
    pub fn recall(&mut self, written: &[u32], question: &[u32]) -> Option<&[u32]> {
        let (op, arguments) = command_at(question)?;
        let is_about_program =
            matches!(op, Command::GetUniformLocation | Command::GetAttribLocation);
        match (op, arguments) {
            (Command::GetParameter, &[it]) if is_followed(it) => {}
            (Command::IsEnabled, &[it]) if is_capability(it) => {}
            _ if is_about_program => {}
            _ => return None,
        }
        if std::mem::replace(&mut self.attention, ATTENTION) == 0 {
            *self = Memo {
                attention: ATTENTION,
                read: written.len(),
                ..Memo::default()
            };
        }
        self.read(written);
        let known = if is_about_program {
            self.locations.get(question)
        } else {
            self.key(arguments[0])
                .and_then(|it| self.parameters.get(&it))
        };
        if known.is_none() {
            self.question = question.into();
        }
        known.map(|it| &**it)
    }

    /// A third word marks an object that may be gone soon.
    pub fn hear(&mut self, answer: &[u32], facts: Facts) {
        let question = std::mem::take(&mut self.question);
        match (&*question, answer) {
            ([], _) | (_, [] | [OBJECT, _, _]) => {}
            (&[_, name], _) => {
                self.may_capture = facts.may_capture;
                self.parameters
                    .insert(ACTIVE_TEXTURE, vec![UINT, facts.active_texture]);
                if let [OBJECT, object @ 1..=u32::MAX] = *answer {
                    self.fits.insert(
                        object,
                        if name == READ_FRAMEBUFFER_BINDING {
                            FRAMEBUFFER_BINDING
                        } else {
                            name
                        },
                    );
                }
                self.key(name)
                    .map(|it| self.parameters.insert(it, answer.into()));
            }
            _ => drop(self.locations.insert(question, answer.into())),
        }
    }
}
