//! A shader that is valid.

use std::cell::Cell;
use std::ops::Range;

use super::builtins::Builtin;
use super::lexer::Known;
use super::{Extensions, Stage};
use crate::webgl::gl;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Scalar {
    Float,
    Int,
    Uint,
    Bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Dimension {
    Flat,
    Volume,
    Cube,
    Layers,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Base {
    Void,
    Number(Scalar),
    /// `Scalar::Bool` stands for a comparison.
    Sampler(Dimension, Scalar),
    /// In `Shader::structs`, which has the uniform blocks too.
    Struct(u32),
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Type {
    pub base: Base,
    pub columns: u8,
    pub rows: u8,
    /// 0 if it is no array.
    pub length: u32,
}

pub const UNSIZED: u32 = u32::MAX;

macro_rules! types {
    ($($name:literal $es1:literal $base:expr, $columns:literal $rows:literal $gl:ident)*) => {
        /// The keyword, whether GLSL ES 1.00 has it, and what the API calls it.
        pub const TYPES: &[(&str, bool, Type, u32)] = {
            use {Base::*, Dimension::*, Scalar::*};
            &[$(($name, $es1 == 1, Type { base: $base, columns: $columns, rows: $rows, length: 0 }, gl::$gl)),*]
        };
    };
}

types! {
    "void" 1 Void, 1 1 NONE
    "float" 1 Number(Float), 1 1 FLOAT "vec2" 1 Number(Float), 1 2 FLOAT_VEC2 "vec3" 1 Number(Float), 1 3 FLOAT_VEC3 "vec4" 1 Number(Float), 1 4 FLOAT_VEC4
    "int" 1 Number(Int), 1 1 INT "ivec2" 1 Number(Int), 1 2 INT_VEC2 "ivec3" 1 Number(Int), 1 3 INT_VEC3 "ivec4" 1 Number(Int), 1 4 INT_VEC4
    "bool" 1 Number(Bool), 1 1 BOOL "bvec2" 1 Number(Bool), 1 2 BOOL_VEC2 "bvec3" 1 Number(Bool), 1 3 BOOL_VEC3 "bvec4" 1 Number(Bool), 1 4 BOOL_VEC4
    "uint" 3 Number(Uint), 1 1 UNSIGNED_INT "uvec2" 3 Number(Uint), 1 2 UNSIGNED_INT_VEC2 "uvec3" 3 Number(Uint), 1 3 UNSIGNED_INT_VEC3
    "uvec4" 3 Number(Uint), 1 4 UNSIGNED_INT_VEC4
    "mat2" 1 Number(Float), 2 2 FLOAT_MAT2 "mat3" 1 Number(Float), 3 3 FLOAT_MAT3 "mat4" 1 Number(Float), 4 4 FLOAT_MAT4
    "mat2x2" 3 Number(Float), 2 2 FLOAT_MAT2 "mat3x3" 3 Number(Float), 3 3 FLOAT_MAT3 "mat4x4" 3 Number(Float), 4 4 FLOAT_MAT4
    "mat2x3" 3 Number(Float), 2 3 FLOAT_MAT2X3 "mat2x4" 3 Number(Float), 2 4 FLOAT_MAT2X4 "mat3x2" 3 Number(Float), 3 2 FLOAT_MAT3X2
    "mat3x4" 3 Number(Float), 3 4 FLOAT_MAT3X4 "mat4x2" 3 Number(Float), 4 2 FLOAT_MAT4X2 "mat4x3" 3 Number(Float), 4 3 FLOAT_MAT4X3
    "sampler2D" 1 Sampler(Flat, Float), 1 1 SAMPLER_2D "samplerCube" 1 Sampler(Cube, Float), 1 1 SAMPLER_CUBE
    "sampler3D" 3 Sampler(Volume, Float), 1 1 SAMPLER_3D "sampler2DArray" 3 Sampler(Layers, Float), 1 1 SAMPLER_2D_ARRAY
    "sampler2DShadow" 3 Sampler(Flat, Bool), 1 1 SAMPLER_2D_SHADOW "samplerCubeShadow" 3 Sampler(Cube, Bool), 1 1 SAMPLER_CUBE_SHADOW
    "sampler2DArrayShadow" 3 Sampler(Layers, Bool), 1 1 SAMPLER_2D_ARRAY_SHADOW
    "isampler2D" 3 Sampler(Flat, Int), 1 1 INT_SAMPLER_2D "isampler3D" 3 Sampler(Volume, Int), 1 1 INT_SAMPLER_3D
    "isamplerCube" 3 Sampler(Cube, Int), 1 1 INT_SAMPLER_CUBE "isampler2DArray" 3 Sampler(Layers, Int), 1 1 INT_SAMPLER_2D_ARRAY
    "usampler2D" 3 Sampler(Flat, Uint), 1 1 UNSIGNED_INT_SAMPLER_2D "usampler3D" 3 Sampler(Volume, Uint), 1 1 UNSIGNED_INT_SAMPLER_3D
    "usamplerCube" 3 Sampler(Cube, Uint), 1 1 UNSIGNED_INT_SAMPLER_CUBE "usampler2DArray" 3 Sampler(Layers, Uint), 1 1 UNSIGNED_INT_SAMPLER_2D_ARRAY
}

impl Type {
    pub const VOID: Type = Type::of(Base::Void);
    pub const FLOAT: Type = Type::vector(Scalar::Float, 1);
    pub const INT: Type = Type::vector(Scalar::Int, 1);
    pub const UINT: Type = Type::vector(Scalar::Uint, 1);
    pub const BOOL: Type = Type::vector(Scalar::Bool, 1);

    pub const fn of(base: Base) -> Type {
        Type {
            base,
            columns: 1,
            rows: 1,
            length: 0,
        }
    }

    pub const fn vector(scalar: Scalar, rows: u8) -> Type {
        Type {
            base: Base::Number(scalar),
            columns: 1,
            rows,
            length: 0,
        }
    }

    pub const fn matrix(columns: u8, rows: u8) -> Type {
        Type {
            base: Base::Number(Scalar::Float),
            columns,
            rows,
            length: 0,
        }
    }

    pub const fn array(self, length: u32) -> Type {
        Type { length, ..self }
    }

    pub fn element(self) -> Type {
        self.array(0)
    }

    pub fn is_array(self) -> bool {
        self.length != 0
    }

    /// Of a scalar, a vector or a matrix.
    pub fn scalar(self) -> Option<Scalar> {
        match self.base {
            Base::Number(scalar) if !self.is_array() => Some(scalar),
            _ => None,
        }
    }

    pub fn is_integer(self) -> bool {
        matches!(self.scalar(), Some(Scalar::Int | Scalar::Uint))
    }

    pub fn is_arithmetic(self) -> bool {
        self.scalar().is_some_and(|it| it != Scalar::Bool)
    }

    pub fn is_scalar(self) -> bool {
        self.scalar().is_some() && self.components() == 1
    }

    pub fn is_matrix(self) -> bool {
        self.columns > 1
    }

    pub fn is_vector(self) -> bool {
        self.scalar().is_some() && self.columns == 1 && self.rows > 1
    }

    pub fn components(self) -> u32 {
        u32::from(self.columns * self.rows)
    }

    /// 1 if it is no array.
    pub fn count(self) -> u32 {
        self.length.max(1)
    }

    fn row(self) -> Option<&'static (&'static str, bool, Type, u32)> {
        TYPES.iter().find(|it| it.2 == self.element())
    }

    /// Of an element, unless that is a struct.
    pub fn keyword(self) -> &'static str {
        self.row().map_or("structure", |it| it.0)
    }

    pub fn gl(self) -> u32 {
        self.row().map_or(gl::NONE, |it| it.3)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Precision {
    #[default]
    None,
    Low,
    Medium,
    High,
}

pub struct Field {
    pub name: Box<str>,
    pub of: Type,
    pub precision: Precision,
    pub is_row_major: bool,
    /// The number of scalars before it.
    pub offset: u32,
}

pub struct Struct {
    pub name: Box<str>,
    pub fields: Vec<Field>,
    pub scalars: u32,
    pub depth: u8,
    pub has_samplers: bool,
    pub has_arrays: bool,
    pub has_integers: bool,
    pub has_booleans: bool,
    pub is_block: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Storage {
    Local,
    Global,
    Constant,
    Parameter(Direction),
    Uniform,
    Block,
    Input,
    Output,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Direction {
    In,
    ConstIn,
    Out,
    InOut,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Interpolation {
    #[default]
    Smooth,
    Flat,
    Linear,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Sampling {
    #[default]
    Center,
    Centroid,
    Sample,
}

pub struct Variable {
    /// Only where the API can ask for it.
    pub name: Box<str>,
    pub of: Type,
    pub storage: Storage,
    pub precision: Precision,
    pub interpolation: Interpolation,
    pub sampling: Sampling,
    pub is_invariant: bool,
    pub location: Option<u32>,
    /// Of a source of blending.
    pub index: Option<u32>,
    pub value: Option<Values>,
    pub is_builtin: bool,
    /// Anywhere in the text.
    pub is_used: bool,
    /// By what `main` may call.
    pub is_active: bool,
    /// One more than the largest index that an array is used with.
    pub reach: u32,
    /// In how many places it is written.
    pub writes: Cell<u32>,
}

impl Variable {
    pub fn new(name: &str, of: Type, storage: Storage, precision: Precision) -> Variable {
        let (interpolation, sampling, location, index, value, reach, writes) = Default::default();
        let (is_invariant, is_builtin, is_used, is_active) = Default::default();
        Variable {
            name: name.into(),
            of,
            storage,
            precision,
            interpolation,
            sampling,
            is_invariant,
            location,
            index,
            value,
            is_builtin,
            is_used,
            is_active,
            reach,
            writes,
        }
    }
}

/// In `Shader::values`: the bits of all scalars, in order.
#[derive(Clone, Copy, Debug)]
pub struct Values {
    pub start: u32,
    pub end: u32,
}

impl Values {
    pub fn range(self) -> Range<usize> {
        self.start as usize..self.end as usize
    }
}

/// In `Shader::expressions`.
pub type Id = u32;

pub enum Node {
    Constant,
    Variable(u32),
    Prefix(Known, Id),
    Postfix(Known, Id),
    /// Assignments and sequences too.
    Binary(Known, Id, Id),
    Conditional(Id, Id, Id),
    Index(Id, Id),
    Field(Id, u32),
    /// As many as the type has rows.
    Swizzle(Id, [u8; 4]),
    Call(u32, Box<[Id]>),
    Builtin(&'static Builtin, Box<[Id]>),
    Construct(Box<[Id]>),
    /// Of what has side effects.
    Length(Id),
}

pub struct Expression {
    pub node: Node,
    pub of: Type,
    /// If it is a constant expression.
    pub value: Option<Values>,
    pub depth: u16,
    /// How many expressions are printed for it.
    pub weight: u32,
    pub has_effects: bool,
    /// It is made of constants and the indices of loops.
    pub is_constant_index: bool,
    /// It only reads constants, uniforms and global variables.
    pub can_initialize_global: bool,
}

pub enum Statement {
    Declare(u32, Option<Id>),
    Evaluate(Id),
    Block(Vec<Statement>),
    If(Id, Box<Statement>, Option<Box<Statement>>),
    /// What comes before the first round is in a block around it.
    Loop {
        condition: Option<Id>,
        step: Option<Id>,
        body: Box<Statement>,
        is_finite: bool,
    },
    DoWhile(Box<Statement>, Id),
    Switch(Id, Vec<Statement>),
    Case(Option<Id>),
    Jump(Known),
    Return(Option<Id>),
}

pub struct Function {
    pub name: Box<str>,
    pub returns: Type,
    pub precision: Precision,
    pub parameters: Vec<u32>,
    pub body: Option<Vec<Statement>>,
    /// How many expressions are printed for it.
    pub size: u32,
    pub nesting: usize,
    pub calls: Vec<u32>,
    /// Variables that are not its own.
    pub uses: Vec<u32>,
}

pub struct Shader {
    pub stage: Stage,
    pub is_es3: bool,
    pub extensions: Extensions,
    pub structs: Vec<Struct>,
    pub variables: Vec<Variable>,
    pub functions: Vec<Function>,
    pub expressions: Vec<Expression>,
    pub values: Vec<u32>,
    /// With their initializers, in order.
    pub globals: Vec<(u32, Option<Id>)>,
    /// What `main` may call, each after what it calls, and `main`.
    pub order: Vec<u32>,
    pub depth_layout: Option<Known>,
}

impl Shader {
    pub fn describe(&self, name: &str, mut fields: Vec<Field>) -> Struct {
        let scalars = fields.iter_mut().fold(0, |sum, it| {
            it.offset = sum;
            self.scalars(it.of).saturating_add(sum)
        });
        let any = |has: fn(&Shader, Type) -> bool| fields.iter().any(|it| has(self, it.of));
        Struct {
            name: name.into(),
            scalars,
            depth: fields
                .iter()
                .filter_map(|it| self.structure(it.of))
                .map(|it| it.depth)
                .max()
                .unwrap_or(0)
                + 1,
            has_samplers: any(Shader::has_samplers),
            has_arrays: any(Shader::has_arrays),
            has_integers: any(Shader::has_integers),
            has_booleans: any(Shader::has_booleans),
            is_block: false,
            fields,
        }
    }

    /// Roughly.
    pub fn bytes(&self) -> u64 {
        (size_of_val(&*self.expressions) * 2
            + size_of_val(&*self.values)
            + size_of_val(&*self.variables)) as u64
    }

    pub fn add_values(&mut self, values: impl IntoIterator<Item = u32>) -> Values {
        let start = self.values.len() as u32;
        self.values.extend(values);
        Values {
            start,
            end: self.values.len() as u32,
        }
    }

    /// The variable that an expression is a part of.
    pub fn root(&self, id: Id) -> Option<u32> {
        match self.expressions[id as usize].node {
            Node::Variable(it) => Some(it),
            Node::Index(it, _) | Node::Field(it, _) | Node::Swizzle(it, _) => self.root(it),
            _ => None,
        }
    }

    /// The lengths of the arrays in which a sampler is looked for. There is a copy of what uses it for each element.
    pub fn choices(&self, mut id: Id) -> impl Iterator<Item = u32> {
        std::iter::from_fn(move || {
            loop {
                let it = &self.expressions[id as usize];
                let (Node::Index(whole, _) | Node::Field(whole, _), true) =
                    (&it.node, self.has_samplers(it.of))
                else {
                    return None;
                };
                id = *whole;
                if matches!(it.node, Node::Index(_, index) if self.expressions[index as usize].value.is_none())
                {
                    return Some(self.expressions[id as usize].of.length);
                }
            }
        })
    }

    pub fn structure(&self, of: Type) -> Option<&Struct> {
        match of.base {
            Base::Struct(index) => Some(&self.structs[index as usize]),
            _ => None,
        }
    }

    pub fn scalars(&self, of: Type) -> u32 {
        self.structure(of)
            .map_or(of.components(), |it| it.scalars)
            .saturating_mul(of.count())
    }

    pub fn has_samplers(&self, of: Type) -> bool {
        matches!(of.base, Base::Sampler(..)) || self.structure(of).is_some_and(|it| it.has_samplers)
    }

    pub fn has_arrays(&self, of: Type) -> bool {
        of.is_array() || self.structure(of).is_some_and(|it| it.has_arrays)
    }

    pub fn has_integers(&self, of: Type) -> bool {
        of.element().is_integer() || self.structure(of).is_some_and(|it| it.has_integers)
    }

    pub fn has_booleans(&self, of: Type) -> bool {
        of.base == Base::Number(Scalar::Bool)
            || self.structure(of).is_some_and(|it| it.has_booleans)
    }

    pub fn builtin(&self, name: &str) -> Option<&Variable> {
        self.variables
            .iter()
            .take_while(|it| it.is_builtin)
            .find(|it| *it.name == *name)
    }

    pub fn uses(&self, builtin: &str) -> bool {
        self.builtin(builtin).is_some_and(|it| it.is_used)
    }

    /// With their numbers.
    pub fn declared(&self, storage: Storage) -> impl Iterator<Item = (u32, &Variable)> + Clone {
        self.globals
            .iter()
            .map(|it| (it.0, &self.variables[it.0 as usize]))
            .filter(move |it| it.1.storage == storage)
    }

    /// `visit` gets the name, the type and the field of all that is no struct. It returns whether to go on.
    pub fn leaves(
        &self,
        of: Type,
        path: &mut Vec<Step>,
        visit: &mut dyn FnMut(&[Step], Type) -> bool,
    ) -> bool {
        let Some(structure) = self.structure(of) else {
            return visit(path, of);
        };
        (0..of.count()).all(|element| {
            (0..).zip(&structure.fields).all(|(index, field)| {
                path.push(Step {
                    element: of.is_array().then_some(element),
                    structure: of,
                    field: index,
                });
                let goes_on = self.leaves(field.of, path, visit);
                path.pop();
                goes_on
            })
        })
    }
}

/// Into a struct.
#[derive(Clone, Copy)]
pub struct Step {
    pub element: Option<u32>,
    pub structure: Type,
    pub field: u32,
}
