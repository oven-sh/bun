//! From two shaders to a program.

use std::cell::RefCell;
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};

use super::print::{Connection, DRAW_ID, Interface, MAX_LENGTH, field_name, print};
use super::tree::*;
use super::{DRAW_BUFFERS, Limits};

/// An attribute, a uniform, an output or what transform feedback captures.
#[derive(Default)]
pub struct Active {
    /// That of an array ends with `[0]`.
    pub name: String,
    pub native_name: String,
    pub kind: u32,
    pub size: u32,
    pub is_array: bool,
    pub location: Option<u32>,
    /// Of a source of blending.
    pub index: u32,
    pub block: Option<u32>,
    pub offset: u32,
    pub array_stride: u32,
    pub matrix_stride: u32,
    pub is_row_major: bool,
}

pub struct Block {
    pub name: String,
    pub native_name: String,
    pub size: u32,
    /// In `Linked::uniforms`.
    pub members: std::ops::Range<u32>,
    pub is_in_stage: [bool; 2],
}

#[derive(Default)]
pub struct Linked {
    pub sources: [String; 2],
    pub attributes: Vec<Active>,
    pub uniforms: Vec<Active>,
    pub blocks: Vec<Block>,
    pub outputs: Vec<Active>,
    pub feedback: Vec<Active>,
    /// The name of the uniform that stands for `gl_DrawID`.
    pub draw_id: Option<&'static str>,
}

pub struct Request<'a> {
    pub shaders: [&'a Shader; 2],
    pub attribute_locations: &'a HashMap<String, u32>,
    pub feedback: &'a [String],
    pub is_feedback_separate: bool,
    pub limits: &'a Limits,
}

type Result<T> = std::result::Result<T, String>;

struct Linker<'a> {
    request: &'a Request<'a>,
    interfaces: [Interface; 2],
    linked: Linked,
    /// Types that were compared. There is no going on after a difference.
    compared: RefCell<HashSet<(Type, Type, bool)>>,
}

fn require(is_met: bool, message: &str, name: &str) -> Result<()> {
    if is_met {
        Ok(())
    } else {
        Err(format!("{message}: '{name}'\n"))
    }
}

pub fn link(request: &Request) -> Result<Linked> {
    let ([vertex, fragment], mut structs) = (request.shaders, HashMap::new());
    require(
        vertex.is_es3 == fragment.is_es3,
        "The shaders are for different versions",
        "#version",
    )?;
    let mut it = Linker {
        request,
        interfaces: request.shaders.map(|it| Interface::new(it, &mut structs)),
        linked: Linked::default(),
        compared: RefCell::default(),
    };
    it.attributes()?;
    it.uniforms()?;
    it.blocks()?;
    it.varyings()?;
    it.outputs();
    it.print().ok_or("The program is too large\n")?;
    it.linked.draw_id = vertex
        .builtin("gl_DrawID")
        .filter(|it| it.is_active)
        .map(|_| DRAW_ID);
    Ok(it.linked)
}

fn active(name: &str, native_name: &str, of: Type) -> Active {
    let name = if of.is_array() {
        format!("{name}[0]")
    } else {
        name.into()
    };
    Active {
        name,
        native_name: native_name.into(),
        kind: of.gl(),
        size: of.count(),
        is_array: of.is_array(),
        ..Active::default()
    }
}

fn by_name(shader: &Shader, storage: Storage) -> HashMap<&str, (u32, &Variable)> {
    let name = |it: &Variable| -> &str {
        shader
            .structure(it.of)
            .filter(|it| it.is_block)
            .map_or("", |it| &it.name)
    };
    shader
        .declared(storage)
        .map(|it| {
            (
                if storage == Storage::Block {
                    name(it.1)
                } else {
                    &*it.1.name
                },
                it,
            )
        })
        .collect()
}

/// Whether the algorithm of the specification finds room for so many rows of such a width.
fn can_pack(mut items: Vec<(u32, u32)>, rows: u32) -> bool {
    items.sort_unstable_by_key(|it| Reverse(*it));
    let total = |width| {
        items
            .iter()
            .filter(|it| it.0 == width)
            .map(|it| it.1)
            .sum::<u32>()
    };
    let Some(free) = rows.checked_sub(total(4) + total(3)) else {
        return false;
    };
    let take = |places: &mut [u32], rows: u32| {
        places
            .iter_mut()
            .filter(|it| **it >= rows)
            .min()
            .map(|it| *it -= rows)
            .is_some()
    };
    let [mut left, mut right] = [[free]; 2];
    let has_room_for_pairs = items
        .iter()
        .filter(|it| it.0 == 2)
        .all(|it| take(&mut left, it.1) || take(&mut right, it.1));
    let mut columns = [left[0], left[0], right[0], right[0] + total(3)];
    has_room_for_pairs
        && items
            .iter()
            .filter(|it| it.0 == 1)
            .all(|it| take(&mut columns, it.1))
}

fn fit<'a>(
    shader: &Shader,
    types: impl Iterator<Item = &'a Type> + Clone,
    rows: u32,
    more: u32,
) -> bool {
    let mut items = Vec::new();
    if types
        .clone()
        .map(|it| u64::from(shader.scalars(*it)))
        .sum::<u64>()
        > u64::from(rows * 4 + more)
    {
        return false;
    }
    for of in types {
        shader.leaves(*of, &mut Vec::new(), &mut |_, it| {
            let width = if it.element() == Type::matrix(2, 2) {
                4
            } else {
                it.rows.into()
            };
            items.extend(
                it.element()
                    .scalar()
                    .map(|_| (width, u32::from(it.columns) * it.count())),
            );
            true
        });
    }
    can_pack(items, rows)
}

/// Alignment and size in a uniform block.
fn measure(shader: &Shader, of: Type, is_row_major: bool) -> (u32, u32) {
    let (alignment, size) = match shader.structure(of) {
        Some(it) => (
            16,
            offsets(shader, it, is_row_major)
                .last()
                .map_or(0, |it| it.1)
                .next_multiple_of(16),
        ),
        None if of.is_matrix() => (
            16,
            16 * u32::from(if is_row_major { of.rows } else { of.columns }),
        ),
        None => (
            4 * u32::from(of.rows).next_power_of_two(),
            4 * u32::from(of.rows),
        ),
    };
    if of.is_array() {
        (16, size.next_multiple_of(16) * of.length)
    } else {
        (alignment, size)
    }
}

/// Where the fields start and end.
fn offsets<'a>(
    shader: &'a Shader,
    structure: &'a Struct,
    is_row_major: bool,
) -> impl Iterator<Item = (u32, u32)> + 'a {
    structure.fields.iter().scan(0u32, move |end, it| {
        let (alignment, size) = measure(shader, it.of, is_row_major || it.is_row_major);
        let start = end.next_multiple_of(alignment);
        *end = start + size;
        Some((start, *end))
    })
}

fn list_members(
    shader: &Shader,
    name: &str,
    of: Type,
    offset: u32,
    is_row_major: bool,
    out: &mut Vec<Active>,
) {
    let stride = if of.is_array() {
        measure(shader, of, is_row_major).1 / of.length
    } else {
        0
    };
    let Some(structure) = shader.structure(of) else {
        let (matrix_stride, is_row_major) = if of.is_matrix() {
            (16, is_row_major)
        } else {
            (0, false)
        };
        return out.push(Active {
            offset,
            array_stride: stride,
            matrix_stride,
            is_row_major,
            ..active(name, "", of)
        });
    };
    let starts: Vec<_> = offsets(shader, structure, is_row_major).collect();
    for element in 0..of.count() {
        let prefix = if of.is_array() {
            format!("{name}[{element}].")
        } else if name.is_empty() {
            String::new()
        } else {
            format!("{name}.")
        };
        for (field, (start, _)) in structure.fields.iter().zip(&starts) {
            list_members(
                shader,
                &format!("{prefix}{}", field.name),
                field.of,
                offset + element * stride + start,
                is_row_major || field.is_row_major,
                out,
            );
        }
    }
}

impl Linker<'_> {
    fn print(&mut self) -> Option<()> {
        (0..2).try_for_each(|stage| {
            print(self.request.shaders[stage], &self.interfaces[stage])
                .map(|it| self.linked.sources[stage] = it)
        })
    }

    fn connect(&mut self, stage: usize, variable: u32, name: String) -> &mut Connection {
        self.interfaces[stage].connections[variable as usize].insert(Connection {
            name,
            ..Connection::default()
        })
    }

    /// Of a type of the vertex shader and one of the fragment shader.
    fn is_same(&self, a: Type, b: Type, compares_precision: bool) -> bool {
        let [vertex, fragment] = self.request.shaders;
        let Some((x, y)) = vertex.structure(a).zip(fragment.structure(b)) else {
            return a == b;
        };
        if !self
            .compared
            .borrow_mut()
            .insert((a, b, compares_precision))
        {
            return true;
        }
        let is_same = |(x, y): (&Field, &Field)| {
            x.name == y.name
                && x.is_row_major == y.is_row_major
                && (x.precision == y.precision || !compares_precision)
                && self.is_same(x.of, y.of, compares_precision)
        };
        a.length == b.length
            && x.name == y.name
            && x.fields.len() == y.fields.len()
            && x.fields.iter().zip(&y.fields).all(is_same)
    }

    fn attributes(&mut self) -> Result<()> {
        let (shader, limit, mut taken) = (
            self.request.shaders[0],
            self.request.limits.vertex_attributes,
            0u64,
        );
        let location = |it: &Variable| {
            it.location
                .or_else(|| self.request.attribute_locations.get(&*it.name).copied())
        };
        let mut all: Vec<_> = shader
            .declared(Storage::Input)
            .map(|(index, it)| (index, it, location(it)))
            .collect();
        all.retain(|it| it.1.is_active || shader.is_es3 && it.2.is_some());
        all.sort_by_key(|it| (it.2.is_none(), Reverse(it.1.of.columns)));
        for (index, it, location) in all {
            let slots = |first: u32| ((1 << it.of.columns) - 1) << first;
            let is_free = |first: &u32| {
                first + u32::from(it.of.columns) <= limit && taken & slots(*first) == 0
            };
            let first = location.map_or(0..limit, |it| it..it + 1).find(is_free);
            require(
                first.is_some(),
                "There is no free location for the attribute",
                &it.name,
            )?;
            taken |= first.map_or(0, slots);
            if it.is_active {
                self.connect(0, index, format!("a{index}")).location = first;
                self.linked.attributes.push(Active {
                    location: first,
                    ..active(&it.name, "", it.of)
                });
            }
        }
        let builtins = ["gl_VertexID", "gl_InstanceID"]
            .iter()
            .filter_map(|it| shader.builtin(it))
            .filter(|it| it.is_active);
        self.linked
            .attributes
            .extend(builtins.map(|it| active(&it.name, "", it.of)));
        Ok(())
    }

    fn uniforms(&mut self) -> Result<()> {
        let (shaders, limits) = (self.request.shaders, self.request.limits);
        let (of_vertex, mut units) = (by_name(shaders[0], Storage::Uniform), [0; 2]);
        for (stage, shader) in shaders.into_iter().enumerate() {
            let used = shader
                .declared(Storage::Uniform)
                .filter(|it| it.1.is_active);
            require(
                fit(
                    shader,
                    used.map(|it| &it.1.of),
                    limits.uniform_vectors[stage],
                    limits.texture_units[stage],
                ),
                "The uniforms do not fit",
                "uniform",
            )?;
            for (index, it) in shader.declared(Storage::Uniform) {
                let twin = of_vertex.get(&*it.name).filter(|_| stage == 1);
                if let Some((_, twin)) = twin {
                    let are_used = twin.is_used && it.is_used;
                    require(
                        self.is_same(twin.of, it.of, are_used)
                            && (twin.precision == it.precision || !are_used),
                        "The shaders disagree about the type or the precision",
                        &it.name,
                    )?;
                }
                if !it.is_active {
                    continue;
                }
                let twin = twin.filter(|it| it.1.is_active);
                let native_name =
                    twin.map_or_else(|| format!("u{stage}_{index}"), |it| format!("u0_{}", it.0));
                let mut members = Vec::new();
                list_members(shader, &it.name, it.of, 0, false, &mut members);
                let mut members = members.into_iter().filter(|_| twin.is_none());
                shader.leaves(it.of, &mut Vec::new(), &mut |path, of| {
                    units[stage] += if let Base::Sampler(..) = of.base {
                        of.count()
                    } else {
                        0
                    };
                    let step = |it: &Step| {
                        format!(
                            "{}.{}",
                            it.element.map_or_else(String::new, |it| format!("[{it}]")),
                            field_name(it.structure, it.field)
                        )
                    };
                    self.linked.uniforms.extend(members.next().map(|it| {
                        Active {
                            native_name: path
                                .iter()
                                .map(step)
                                .fold(native_name.clone(), |all, it| all + &it),
                            ..it
                        }
                    }));
                    true
                });
                self.connect(stage, index, native_name);
            }
            require(
                units[stage] <= limits.texture_units[stage],
                "There are more samplers than texture units",
                "uniform",
            )?;
        }
        if shaders
            .iter()
            .filter_map(|it| it.builtin("gl_DepthRange"))
            .any(|it| it.is_active)
        {
            self.linked.uniforms.extend(
                [
                    "gl_DepthRange.near",
                    "gl_DepthRange.far",
                    "gl_DepthRange.diff",
                ]
                .map(|it| active(it, it, Type::FLOAT)),
            );
        }
        require(
            units[0] + units[1] <= limits.combined_texture_units,
            "There are more samplers than texture units",
            "uniform",
        )
    }

    fn blocks(&mut self) -> Result<()> {
        let (shaders, limits, mut counts, mut letters) =
            (self.request.shaders, self.request.limits, [0; 2], 0);
        let declared = shaders.map(|it| by_name(it, Storage::Block));
        for (stage, shader) in shaders.into_iter().enumerate() {
            for (index, it) in shader.declared(Storage::Block) {
                let Some(block) = shader.structure(it.of) else {
                    continue;
                };
                let twin = declared[1 - stage].get(&*block.name);
                counts[stage] += it.of.count();
                require(
                    counts[stage] <= limits.uniform_blocks[stage]
                        && counts[0] + counts[1] <= limits.combined_uniform_blocks,
                    "There are more uniform blocks than allowed",
                    &block.name,
                )?;
                if let (Some(twin), 1) = (twin, stage) {
                    require(
                        self.is_same(twin.1.of, it.of, true),
                        "The shaders disagree about the members",
                        &block.name,
                    )?;
                    self.connect(1, index, format!("b0_{}", twin.0));
                    continue;
                }
                let (size, first) = (
                    measure(shader, it.of.element(), false).1,
                    self.linked.uniforms.len(),
                );
                require(
                    size <= limits.uniform_block_size,
                    "The block is larger than MAX_UNIFORM_BLOCK_SIZE",
                    &block.name,
                )?;
                list_members(
                    shader,
                    if it.name.is_empty() { "" } else { &block.name },
                    it.of.element(),
                    0,
                    false,
                    &mut self.linked.uniforms,
                );
                letters += self.linked.uniforms[first..]
                    .iter()
                    .map(|it| it.name.len())
                    .sum::<usize>();
                require(
                    letters <= MAX_LENGTH,
                    "The names of the members of blocks are too long",
                    &block.name,
                )?;
                self.linked.uniforms[first..]
                    .iter_mut()
                    .for_each(|it| it.block = Some(self.linked.blocks.len() as u32));
                let native_name = format!("b{stage}_{index}");
                for element in 0..it.of.count() {
                    let suffix = if it.of.is_array() {
                        format!("[{element}]")
                    } else {
                        String::new()
                    };
                    let (name, native_name, members) = (
                        format!("{}{suffix}", block.name),
                        format!("{native_name}{suffix}"),
                        first as u32..self.linked.uniforms.len() as u32,
                    );
                    self.linked.blocks.push(Block {
                        name,
                        native_name,
                        size,
                        members,
                        is_in_stage: [stage == 0, stage == 1 || twin.is_some()],
                    });
                }
                self.connect(stage, index, native_name);
            }
        }
        let mut names = HashSet::new();
        self.linked.uniforms.iter().try_for_each(|it| {
            require(
                names.insert(&it.name),
                "The name stands for two uniforms",
                &it.name,
            )
        })
    }

    fn connect_output(&mut self, index: u32, it: &Variable) -> String {
        let connection = self.connect(0, index, format!("i{index}"));
        (connection.is_invariant, connection.sampling) = (it.is_invariant, it.sampling);
        connection.name.clone()
    }

    fn varyings(&mut self) -> Result<()> {
        let ([vertex, fragment], limits) = (self.request.shaders, self.request.limits);
        let outputs = by_name(vertex, Storage::Output);
        for (index, it) in fragment.declared(Storage::Input) {
            let Some(&(source, output)) = outputs.get(&*it.name) else {
                require(
                    !it.is_used,
                    "The vertex shader has no such output",
                    &it.name,
                )?;
                continue;
            };
            let is_same = self.is_same(output.of, it.of, false)
                && output.interpolation == it.interpolation
                && (vertex.is_es3 || output.is_invariant == it.is_invariant);
            require(
                is_same,
                "The shaders disagree about the type or the qualifiers",
                &it.name,
            )?;
            if it.is_active {
                let name = self.connect_output(
                    source,
                    &Variable {
                        sampling: it.sampling,
                        is_invariant: output.is_invariant,
                        ..Variable::new("", it.of, it.storage, it.precision)
                    },
                );
                self.connect(1, index, name).sampling = it.sampling;
            }
        }
        let is_invariant =
            |shader: &Shader, name| shader.builtin(name).is_some_and(|it| it.is_invariant);
        for (input, output) in [
            ("gl_FragCoord", "gl_Position"),
            ("gl_PointCoord", "gl_PointSize"),
        ] {
            require(
                !is_invariant(fragment, input) || is_invariant(vertex, output),
                "It can only be invariant if the output that it depends on is",
                input,
            )?;
        }
        for name in ["gl_ClipDistance", "gl_CullDistance"] {
            let length = |shader: &Shader| shader.builtin(name).map_or(0, |it| it.of.length);
            require(
                length(fragment) == 0 || length(fragment) == length(vertex),
                "It must have the same size in both shaders",
                name,
            )?;
        }
        self.feedback(&outputs)?;
        let is_connected =
            |it: &(u32, &Variable)| self.interfaces[0].connections[it.0 as usize].is_some();
        let of_builtins = ["gl_FragCoord", "gl_PointCoord"]
            .iter()
            .filter_map(|it| fragment.builtin(it))
            .filter(|it| it.is_active && !vertex.is_es3);
        let types = vertex
            .declared(Storage::Output)
            .filter(is_connected)
            .map(|it| &it.1.of)
            .chain(of_builtins.map(|it| &it.of));
        require(
            fit(vertex, types, limits.varying_vectors, 0),
            "The varyings do not fit",
            "varying",
        )
    }

    fn feedback(&mut self, outputs: &HashMap<&str, (u32, &Variable)>) -> Result<()> {
        let (request, vertex, mut components) = (self.request, self.request.shaders[0], 0);
        let mut taken = Vec::<(&str, Option<u32>)>::new();
        require(
            !request.is_feedback_separate
                || request.feedback.len() <= request.limits.separate_feedback_attributes as usize,
            "There are more varyings than buffers to capture them",
            "",
        )?;
        for name in request.feedback {
            let subscript = name
                .strip_suffix(']')
                .and_then(|it| it.split_once('['))
                .and_then(|it| Some((it.0, it.1.parse::<u32>().ok()?)));
            let (base, element) = subscript.map_or((&**name, None), |it| (it.0, Some(it.1)));
            let builtin = [
                ("gl_Position", Type::vector(Scalar::Float, 4)),
                ("gl_PointSize", Type::FLOAT),
            ]
            .into_iter()
            .find(|it| it.0 == base && vertex.builtin(base).is_some_and(|it| it.is_active));
            let of = builtin
                .map(|it| it.1)
                .or_else(|| Some(outputs.get(base)?.1.of))
                .filter(|it| {
                    it.element().scalar().is_some() && element.is_none_or(|at| at < it.length)
                });
            let Some(of) = of.map(|it| if element.is_some() { it.element() } else { it }) else {
                return require(false, "There is no such output to capture", name);
            };
            require(
                !taken.iter().any(|it| {
                    it.0 == base && (it.1 == element || it.1.is_none() || element.is_none())
                }),
                "It would be captured twice",
                name,
            )?;
            taken.push((base, element));
            components = vertex.scalars(of)
                + if request.is_feedback_separate {
                    0
                } else {
                    components
                };
            require(
                components
                    <= if request.is_feedback_separate {
                        4
                    } else {
                        request.limits.interleaved_feedback_components
                    },
                "It is too much to capture",
                name,
            )?;
            let native_base = match outputs.get(base) {
                Some(&(index, it)) => self.interfaces[0].connections[index as usize]
                    .clone()
                    .map_or_else(|| self.connect_output(index, it), |it| it.name),
                None => base.into(),
            };
            self.linked.feedback.push(Active {
                name: name.clone(),
                ..active(
                    "",
                    &element
                        .map_or_else(|| native_base.clone(), |it| format!("{native_base}[{it}]")),
                    of,
                )
            });
        }
        Ok(())
    }

    fn outputs(&mut self) {
        let shader = self.request.shaders[1];
        for (index, it) in shader.declared(Storage::Output).filter(|it| it.1.is_active) {
            let (connection, location) = (
                self.connect(1, index, format!("o{index}")),
                it.location.or(Some(0)),
            );
            (connection.location, connection.is_invariant) = (location, it.is_invariant);
            self.linked.outputs.push(Active {
                location,
                index: it.index.unwrap_or(0),
                ..active(&it.name, "", it.of)
            });
        }
        let has_two_sources = ["gl_SecondaryFragColorEXT", "gl_SecondaryFragDataEXT"]
            .iter()
            .filter_map(|it| shader.builtin(it))
            .any(|it| it.is_active);
        let colors = if shader.extensions & DRAW_BUFFERS != 0 && !has_two_sources {
            self.request.limits.draw_buffers
        } else {
            1
        };
        self.interfaces[1].colors = colors;
        for (name, index) in [
            ("gl_FragColor", 0),
            ("gl_FragData", 0),
            ("gl_SecondaryFragColorEXT", 1),
            ("gl_SecondaryFragDataEXT", 1),
        ] {
            let Some(it) = shader.builtin(name).filter(|it| it.is_active) else {
                continue;
            };
            let size = if index == 0 { colors } else { it.of.count() };
            self.linked.outputs.push(Active {
                location: Some(0),
                index,
                size,
                ..active(name, "", it.of)
            });
        }
    }
}
