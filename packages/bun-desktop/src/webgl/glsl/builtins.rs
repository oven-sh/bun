//! The functions, variables and reserved words of the language.

use std::sync::LazyLock;

use super::tree::{Base, Dimension, Scalar, Storage, TYPES, Type, UNSIZED};
use super::*;
use crate::hash::FastMap;

const ES1: u8 = 1;
const ES3: u8 = 2;
const VERTEX: u8 = 4;
const FRAGMENT: u8 = 8;
const ANY_VERSION: u8 = ES1 | ES3;
const ANY_STAGE: u8 = VERTEX | FRAGMENT;

#[derive(Clone, Copy)]
pub struct Condition {
    when: u8,
    extension: Extensions,
}

impl Condition {
    pub fn is_met(self, stage: Stage, is_es3: bool, extensions: Extensions) -> bool {
        let wanted = if is_es3 { ES3 } else { ES1 }
            | if stage == Stage::Vertex {
                VERTEX
            } else {
                FRAGMENT
            };
        self.when & wanted == wanted && self.extension & !extensions == 0
    }
}

/// The result and then the parameters. `F`, `I`, `U` and `B` have the same 1 to 4 components, or 2 to 4 with `+`. `>` is written, `!` is an offset in
/// texels, `@` is an input of the shader, and `?` is the bias that a fragment shader can pass.
const FUNCTIONS: &[(u8, Extensions, &str, &str)] = &[
    (
        ANY_VERSION | ANY_STAGE,
        0,
        "radians degrees sin cos tan asin acos atan exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract normalize",
        "F F",
    ),
    (
        ANY_VERSION | ANY_STAGE,
        0,
        "atan pow mod min max step reflect",
        "F F F",
    ),
    (ANY_VERSION | ANY_STAGE, 0, "mod min max", "F F float"),
    (
        ANY_VERSION | ANY_STAGE,
        0,
        "clamp mix smoothstep faceforward",
        "F F F F",
    ),
    (ANY_VERSION | ANY_STAGE, 0, "clamp", "F F float float"),
    (ANY_VERSION | ANY_STAGE, 0, "mix refract", "F F F float"),
    (ANY_VERSION | ANY_STAGE, 0, "step", "F float F"),
    (ANY_VERSION | ANY_STAGE, 0, "smoothstep", "F float float F"),
    (ANY_VERSION | ANY_STAGE, 0, "length", "float F"),
    (ANY_VERSION | ANY_STAGE, 0, "distance dot", "float F F"),
    (ANY_VERSION | ANY_STAGE, 0, "cross", "vec3 vec3 vec3"),
    (ANY_VERSION | ANY_STAGE, 0, "matrixCompMult", "mat mat mat"),
    (
        ANY_VERSION | ANY_STAGE,
        0,
        "lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual",
        "B F+ F+; B I+ I+; B U+ U+",
    ),
    (ANY_VERSION | ANY_STAGE, 0, "equal notEqual", "B B+ B+"),
    (ANY_VERSION | ANY_STAGE, 0, "any all", "bool B+"),
    (ANY_VERSION | ANY_STAGE, 0, "not", "B B+"),
    (ES1 | ANY_STAGE, 0, "texture2D", "vec4 sampler2D vec2 ?"),
    (
        ES1 | ANY_STAGE,
        0,
        "texture2DProj",
        "vec4 sampler2D vec3 ?; vec4 sampler2D vec4 ?",
    ),
    (ES1 | ANY_STAGE, 0, "textureCube", "vec4 samplerCube vec3 ?"),
    (ES1 | VERTEX, 0, "texture2DLod", "vec4 sampler2D vec2 float"),
    (
        ES1 | VERTEX,
        0,
        "texture2DProjLod",
        "vec4 sampler2D vec3 float; vec4 sampler2D vec4 float",
    ),
    (
        ES1 | VERTEX,
        0,
        "textureCubeLod",
        "vec4 samplerCube vec3 float",
    ),
    (
        ES1 | FRAGMENT,
        TEXTURE_LOD,
        "texture2DLodEXT",
        "vec4 sampler2D vec2 float",
    ),
    (
        ES1 | FRAGMENT,
        TEXTURE_LOD,
        "texture2DProjLodEXT",
        "vec4 sampler2D vec3 float; vec4 sampler2D vec4 float",
    ),
    (
        ES1 | FRAGMENT,
        TEXTURE_LOD,
        "textureCubeLodEXT",
        "vec4 samplerCube vec3 float",
    ),
    (
        ES1 | ANY_STAGE,
        TEXTURE_LOD,
        "texture2DGradEXT",
        "vec4 sampler2D vec2 vec2 vec2",
    ),
    (
        ES1 | ANY_STAGE,
        TEXTURE_LOD,
        "texture2DProjGradEXT",
        "vec4 sampler2D vec3 vec2 vec2; vec4 sampler2D vec4 vec2 vec2",
    ),
    (
        ES1 | ANY_STAGE,
        TEXTURE_LOD,
        "textureCubeGradEXT",
        "vec4 samplerCube vec3 vec3 vec3",
    ),
    (ES1 | FRAGMENT, DERIVATIVES, "dFdx dFdy fwidth", "F F"),
    (ES3 | FRAGMENT, 0, "dFdx dFdy fwidth", "F F"),
    (
        ES3 | FRAGMENT,
        INTERPOLATION,
        "interpolateAtCentroid",
        "F @F",
    ),
    (
        ES3 | FRAGMENT,
        INTERPOLATION,
        "interpolateAtSample",
        "F @F int",
    ),
    (
        ES3 | FRAGMENT,
        INTERPOLATION,
        "interpolateAtOffset",
        "F @F vec2",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "sinh cosh tanh asinh acosh atanh trunc round roundEven",
        "F F",
    ),
    (ES3 | ANY_STAGE, 0, "abs sign", "I I"),
    (ES3 | ANY_STAGE, 0, "modf", "F F >F"),
    (
        ES3 | ANY_STAGE,
        0,
        "min max",
        "I I I; I I int; U U U; U U uint",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "clamp",
        "I I I I; I I int int; U U U U; U U uint uint",
    ),
    (ES3 | ANY_STAGE, 0, "mix", "F F F B"),
    (ES3 | ANY_STAGE, 0, "isnan isinf", "B F"),
    (ES3 | ANY_STAGE, 0, "floatBitsToInt", "I F"),
    (ES3 | ANY_STAGE, 0, "floatBitsToUint", "U F"),
    (ES3 | ANY_STAGE, 0, "intBitsToFloat", "F I"),
    (ES3 | ANY_STAGE, 0, "uintBitsToFloat", "F U"),
    (
        ES3 | ANY_STAGE,
        0,
        "packSnorm2x16 packUnorm2x16 packHalf2x16",
        "uint vec2",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "unpackSnorm2x16 unpackUnorm2x16 unpackHalf2x16",
        "vec2 uint",
    ),
    (ES3 | ANY_STAGE, 0, "outerProduct", "product vec vec"),
    (ES3 | ANY_STAGE, 0, "transpose", "transposed mat"),
    (
        ES3 | ANY_STAGE,
        0,
        "determinant",
        "float mat2; float mat3; float mat4",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "inverse",
        "mat2 mat2; mat3 mat3; mat4 mat4",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureSize",
        "ivec2 2D int; ivec3 3D int; ivec2 Cube int; ivec3 Array int; ivec2 sampler2DShadow int; \
        ivec2 samplerCubeShadow int; ivec3 sampler2DArrayShadow int",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "texture",
        "texel 2D vec2 ?; texel 3D vec3 ?; texel Cube vec3 ?; texel Array vec3 ?; float sampler2DShadow vec3 ?; \
        float samplerCubeShadow vec4 ?; float sampler2DArrayShadow vec4",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureProj",
        "texel 2D vec3 ?; texel 2D vec4 ?; texel 3D vec4 ?; float sampler2DShadow vec4 ?",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureLod",
        "texel 2D vec2 float; texel 3D vec3 float; texel Cube vec3 float; texel Array vec3 float; float sampler2DShadow vec3 float",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureOffset",
        "texel 2D vec2 !ivec2 ?; texel 3D vec3 !ivec3 ?; texel Array vec3 !ivec2 ?; float sampler2DShadow vec3 !ivec2 ?",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "texelFetch",
        "texel 2D ivec2 int; texel 3D ivec3 int; texel Array ivec3 int",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "texelFetchOffset",
        "texel 2D ivec2 int !ivec2; texel 3D ivec3 int !ivec3; texel Array ivec3 int !ivec2",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureProjOffset",
        "texel 2D vec3 !ivec2 ?; texel 2D vec4 !ivec2 ?; texel 3D vec4 !ivec3 ?; float sampler2DShadow vec4 !ivec2 ?",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureLodOffset",
        "texel 2D vec2 float !ivec2; texel 3D vec3 float !ivec3; texel Array vec3 float !ivec2; \
        float sampler2DShadow vec3 float !ivec2",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureProjLod",
        "texel 2D vec3 float; texel 2D vec4 float; texel 3D vec4 float; float sampler2DShadow vec4 float",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureProjLodOffset",
        "texel 2D vec3 float !ivec2; texel 2D vec4 float !ivec2; texel 3D vec4 float !ivec3; \
        float sampler2DShadow vec4 float !ivec2",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureGrad",
        "texel 2D vec2 vec2 vec2; texel 3D vec3 vec3 vec3; texel Cube vec3 vec3 vec3; texel Array vec3 vec2 vec2; \
        float sampler2DShadow vec3 vec2 vec2; float samplerCubeShadow vec4 vec3 vec3; float sampler2DArrayShadow vec4 vec2 vec2",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureGradOffset",
        "texel 2D vec2 vec2 vec2 !ivec2; texel 3D vec3 vec3 vec3 !ivec3; texel Array vec3 vec2 vec2 !ivec2; \
        float sampler2DShadow vec3 vec2 vec2 !ivec2; float sampler2DArrayShadow vec4 vec2 vec2 !ivec2",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureProjGrad",
        "texel 2D vec3 vec2 vec2; texel 2D vec4 vec2 vec2; texel 3D vec4 vec3 vec3; float sampler2DShadow vec4 vec2 vec2",
    ),
    (
        ES3 | ANY_STAGE,
        0,
        "textureProjGradOffset",
        "texel 2D vec3 vec2 vec2 !ivec2; texel 2D vec4 vec2 vec2 !ivec2; texel 3D vec4 vec3 vec3 !ivec3; \
        float sampler2DShadow vec4 vec2 vec2 !ivec2",
    ),
];

#[derive(Clone, Copy)]
enum Pattern {
    Exactly(Type),
    /// With at least so many components.
    Generic(Scalar, u8),
    AnyVector,
    AnyMatrix,
    AnySampler(Dimension),
    Texel,
    Product,
    Transposed,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Role {
    Value,
    Written,
    Offset,
    Interpolant,
}

pub struct Builtin {
    pub name: &'static str,
    condition: Condition,
    returns: Pattern,
    parameters: Vec<Pattern>,
    pub roles: Vec<Role>,
}

fn named(keyword: &str) -> Type {
    TYPES
        .iter()
        .find(|it| it.0 == keyword)
        .expect("it is a keyword")
        .2
}

fn pattern(word: &str) -> Pattern {
    let scalars = [
        ("F", Scalar::Float),
        ("I", Scalar::Int),
        ("U", Scalar::Uint),
        ("B", Scalar::Bool),
    ];
    match word {
        "vec" => Pattern::AnyVector,
        "mat" => Pattern::AnyMatrix,
        "2D" => Pattern::AnySampler(Dimension::Flat),
        "3D" => Pattern::AnySampler(Dimension::Volume),
        "Cube" => Pattern::AnySampler(Dimension::Cube),
        "Array" => Pattern::AnySampler(Dimension::Layers),
        "texel" => Pattern::Texel,
        "product" => Pattern::Product,
        "transposed" => Pattern::Transposed,
        "?" => Pattern::Exactly(Type::FLOAT),
        _ => scalars
            .iter()
            .find(|it| it.0 == word.trim_end_matches('+'))
            .map_or_else(
                || Pattern::Exactly(named(word)),
                |it| Pattern::Generic(it.1, word.len() as u8),
            ),
    }
}

static BY_NAME: LazyLock<FastMap<&str, Vec<Builtin>>> = LazyLock::new(|| {
    let mut all = FastMap::<_, Vec<_>>::default();
    for &(when, extension, names, signatures) in FUNCTIONS {
        for (name, signature) in names
            .split(' ')
            .flat_map(|name| signatures.split(';').map(move |it| (name, it.trim())))
        {
            for (signature, when) in [(
                signature,
                if signature.ends_with('?') {
                    when & !VERTEX
                } else {
                    when
                },
            )]
            .into_iter()
            .chain(signature.strip_suffix(" ?").map(|it| (it, when)))
            {
                let role = |word: &str| {
                    [
                        ('>', Role::Written),
                        ('!', Role::Offset),
                        ('@', Role::Interpolant),
                    ]
                    .iter()
                    .find(|it| word.starts_with(it.0))
                    .map_or(Role::Value, |it| it.1)
                };
                let mut patterns = signature
                    .split(' ')
                    .map(|it| pattern(it.trim_start_matches(['>', '!', '@'])));
                let (returns, parameters, roles) = (
                    patterns.next().expect("it has a result"),
                    patterns.collect(),
                    signature.split(' ').skip(1).map(role).collect(),
                );
                all.entry(name).or_default().push(Builtin {
                    name,
                    condition: Condition { when, extension },
                    returns,
                    parameters,
                    roles,
                });
            }
        }
    }
    all
});

pub fn functions(
    name: &str,
    stage: Stage,
    is_es3: bool,
    extensions: Extensions,
) -> impl Iterator<Item = &'static Builtin> {
    BY_NAME
        .get(name)
        .into_iter()
        .flatten()
        .filter(move |it| it.condition.is_met(stage, is_es3, extensions))
}

impl Builtin {
    /// What it returns, if it takes such arguments.
    pub fn result(&self, arguments: &[Type]) -> Option<Type> {
        let mut rows = None;
        let fits = |(pattern, given): (&Pattern, &Type)| match *pattern {
            Pattern::Exactly(of) => of == *given,
            Pattern::Generic(scalar, least) => {
                given.rows >= least
                    && *given == Type::vector(scalar, *rows.get_or_insert(given.rows))
            }
            Pattern::AnyVector => given.is_vector() && given.scalar() == Some(Scalar::Float),
            Pattern::AnyMatrix => given.is_matrix() && !given.is_array() && *given == arguments[0],
            Pattern::AnySampler(wanted) => {
                matches!(given.base, Base::Sampler(it, result) if it == wanted && result != Scalar::Bool)
                    && !given.is_array()
            }
            Pattern::Texel | Pattern::Product | Pattern::Transposed => false,
        };
        (arguments.len() == self.parameters.len()
            && self.parameters.iter().zip(arguments).all(fits))
        .then_some(())?;
        Some(match (self.returns, arguments[0].base) {
            (Pattern::Exactly(of), _) => of,
            (Pattern::Generic(scalar, _), _) => Type::vector(scalar, rows?),
            (Pattern::Texel, Base::Sampler(_, scalar)) => Type::vector(scalar, 4),
            (Pattern::Product, _) => Type::matrix(arguments[1].rows, arguments[0].rows),
            (Pattern::Transposed, _) => Type::matrix(arguments[0].rows, arguments[0].columns),
            _ => arguments[0],
        })
    }

    pub fn reads_texture(&self) -> bool {
        self.name.starts_with("tex")
    }

    /// In GLSL ES 3.00.
    pub fn modern_name(&self) -> &'static str {
        let renamed = [
            "textureProjLod",
            "textureProjGrad",
            "textureProj",
            "textureLod",
            "textureGrad",
            "texture",
        ];
        let kind = ["texture2D", "textureCube"]
            .iter()
            .find_map(|it| self.name.strip_prefix(it));
        kind.and_then(|kind| {
            renamed
                .into_iter()
                .find(|it| it[7..] == *kind.trim_end_matches("EXT"))
        })
        .unwrap_or(self.name)
    }
}

pub struct Predeclared {
    pub name: &'static str,
    pub condition: Condition,
    pub of: Type,
    pub storage: Storage,
    /// Of a constant, or the length of an array.
    pub number: fn(&Limits) -> u32,
}

macro_rules! variables {
    ($($when:expr, $extension:expr, $storage:ident $of:expr => $($name:literal $(= $number:expr)?),*;)*) => {
        pub const VARIABLES: &[Predeclared] = &[$($(Predeclared {
            name: $name,
            condition: Condition { when: $when, extension: $extension },
            of: $of,
            storage: Storage::$storage,
            number: { const ALL: &[fn(&Limits) -> u32] = &[$($number,)? |_| 0]; ALL[0] },
        },)*)*];
    };
}

const VEC4: Type = Type::vector(Scalar::Float, 4);

variables! {
    ANY_VERSION | VERTEX, 0, Output VEC4 => "gl_Position";
    ANY_VERSION | VERTEX, 0, Output Type::FLOAT => "gl_PointSize";
    ES3 | VERTEX, 0, Input Type::INT => "gl_VertexID", "gl_InstanceID";
    ANY_VERSION | VERTEX, MULTI_DRAW, Input Type::INT => "gl_DrawID";
    ES3 | VERTEX, CLIP_CULL, Output Type::FLOAT.array(UNSIZED) => "gl_ClipDistance", "gl_CullDistance";
    ES3 | FRAGMENT, CLIP_CULL, Input Type::FLOAT.array(UNSIZED) => "gl_ClipDistance", "gl_CullDistance";
    ANY_VERSION | FRAGMENT, 0, Input VEC4 => "gl_FragCoord";
    ANY_VERSION | FRAGMENT, 0, Input Type::BOOL => "gl_FrontFacing";
    ANY_VERSION | FRAGMENT, 0, Input Type::vector(Scalar::Float, 2) => "gl_PointCoord";
    ES1 | FRAGMENT, 0, Output VEC4 => "gl_FragColor";
    ES1 | FRAGMENT, 0, Output VEC4.array(1) => "gl_FragData" = |it| it.draw_buffers;
    ES1 | FRAGMENT, DUAL_SOURCE, Output VEC4 => "gl_SecondaryFragColorEXT";
    ES1 | FRAGMENT, DUAL_SOURCE, Output VEC4.array(1) => "gl_SecondaryFragDataEXT" = |it| it.dual_source_draw_buffers;
    ES1 | FRAGMENT, FRAG_DEPTH, Output Type::FLOAT => "gl_FragDepthEXT";
    ES3 | FRAGMENT, 0, Output Type::FLOAT => "gl_FragDepth";
    ES3 | FRAGMENT, SAMPLE_VARIABLES, Input Type::INT => "gl_SampleID", "gl_NumSamples";
    ES3 | FRAGMENT, SAMPLE_VARIABLES, Input Type::vector(Scalar::Float, 2) => "gl_SamplePosition";
    ES3 | FRAGMENT, SAMPLE_VARIABLES, Input Type::INT.array(1) => "gl_SampleMaskIn" = |it| it.samples.div_ceil(32);
    ES3 | FRAGMENT, SAMPLE_VARIABLES, Output Type::INT.array(1) => "gl_SampleMask" = |it| it.samples.div_ceil(32);
    ANY_VERSION | ANY_STAGE, 0, Uniform Type::of(Base::Struct(0)) => "gl_DepthRange";
    ANY_VERSION | ANY_STAGE, 0, Constant Type::INT => "gl_MaxVertexAttribs" = |it| it.vertex_attributes, "gl_MaxVertexUniformVectors" = |it| it.uniform_vectors[0],
        "gl_MaxFragmentUniformVectors" = |it| it.uniform_vectors[1], "gl_MaxVertexTextureImageUnits" = |it| it.texture_units[0],
        "gl_MaxTextureImageUnits" = |it| it.texture_units[1], "gl_MaxCombinedTextureImageUnits" = |it| it.combined_texture_units,
        "gl_MaxDrawBuffers" = |it| it.draw_buffers;
    ES1 | ANY_STAGE, 0, Constant Type::INT => "gl_MaxVaryingVectors" = |it| it.varying_vectors;
    ES3 | ANY_STAGE, 0, Constant Type::INT => "gl_MaxVertexOutputVectors" = |it| it.stage_vectors[0], "gl_MaxFragmentInputVectors" = |it| it.stage_vectors[1],
        "gl_MinProgramTexelOffset" = |it| it.texel_offsets[0] as u32, "gl_MaxProgramTexelOffset" = |it| it.texel_offsets[1] as u32;
    ANY_VERSION | ANY_STAGE, DUAL_SOURCE, Constant Type::INT => "gl_MaxDualSourceDrawBuffersEXT" = |it| it.dual_source_draw_buffers;
    ES3 | ANY_STAGE, CLIP_CULL, Constant Type::INT => "gl_MaxClipDistances" = |it| it.distances[0], "gl_MaxCullDistances" = |it| it.distances[1],
        "gl_MaxCombinedClipAndCullDistances" = |it| it.distances[2];
    ES3 | ANY_STAGE, SAMPLE_VARIABLES, Constant Type::INT => "gl_MaxSamples" = |it| it.samples;
}

const KEYWORDS: &str = "const uniform break continue do for while if else in out inout true false lowp mediump highp precision invariant discard return struct \
    attribute varying switch default flat asm class union enum typedef template this goto inline noinline volatile public static extern external interface \
    long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sampler1D sampler3D sampler1DShadow \
    sampler2DShadow sampler2DRect sampler3DRect sampler2DRectShadow sizeof cast namespace using";
const KEYWORDS_OF_ES1: &str = "packed";
const KEYWORDS_OF_ES3: &str = "layout centroid smooth case coherent restrict readonly writeonly resource atomic_uint noperspective patch sample subroutine common \
    partition active filter image1D image2D image3D imageCube iimage1D iimage2D iimage3D iimageCube uimage1D uimage2D uimage3D uimageCube image1DArray \
    image2DArray iimage1DArray iimage2DArray uimage1DArray uimage2DArray image1DShadow image2DShadow image1DArrayShadow image2DArrayShadow imageBuffer \
    iimageBuffer uimageBuffer sampler1DArray sampler1DArrayShadow isampler1D isampler1DArray usampler1D usampler1DArray isampler2DRect usampler2DRect \
    samplerBuffer isamplerBuffer usamplerBuffer sampler2DMS isampler2DMS usampler2DMS sampler2DMSArray isampler2DMSArray usampler2DMSArray";

pub fn keywords(is_es3: bool) -> impl Iterator<Item = &'static str> {
    KEYWORDS.split(' ').chain(
        if is_es3 {
            KEYWORDS_OF_ES3
        } else {
            KEYWORDS_OF_ES1
        }
        .split(' '),
    )
}
