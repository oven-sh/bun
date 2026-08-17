suffixes = {
    f: f32,
    h: f16,
    i: i32,
    u: u32,
}

[2, 3, 4].each do |n|
    suffixes.each do |suffix, type|
        type_alias :"vec#{n}#{suffix}", vec[n][type]
    end

    [2, 3, 4].each do |m|
        type_alias :"mat#{n}x#{m}f", mat[n,m][f32]
        type_alias :"mat#{n}x#{m}h", mat[n,m][f16]
    end
end

# 8.6. Logical Expressions (https://gpuweb.github.io/gpuweb/wgsl/#logical-expr)

operator :!, {
    must_use: true,
    const: 'constantNot',

    [].(bool) => bool,
    [N].(vec[N][bool]) => vec[N][bool],
}

operator :'||', {
    must_use: true,
    const: 'constantOr',

    [].(bool, bool) => bool,
}

operator :'&&', {
    must_use: true,
    const: 'constantAnd',

    [].(bool, bool) => bool,
}

operator :'|', {
    must_use: true,
    const: 'constantBitwiseOr',

    [].(bool, bool) => bool,
    [N].(vec[N][bool], vec[N][bool]) => vec[N][bool],
}

operator :'&', {
    must_use: true,
    const: 'constantBitwiseAnd',

    # binary
    [].(bool, bool) => bool,
    [N].(vec[N][bool], vec[N][bool]) => vec[N][bool],
}

# 8.7. Arithmetic Expressions (https://www.w3.org/TR/WGSL/#arithmetic-expr)

operator :-, {
    must_use: true,
    const: "constantMinus",
    validate: "validateMinus",

    # unary
    [T < SignedNumber].(T) => T,
    [T < SignedNumber, N].(vec[N][T]) => vec[N][T],

    # binary
    [T < Number].(T, T) => T,
    [T < Number, N].(vec[N][T], T) => vec[N][T],
    [T < Number, N].(T, vec[N][T]) => vec[N][T],
    [T < Number, N].(vec[N][T], vec[N][T]) => vec[N][T],
    [T < Float, C, R].(mat[C,R][T], mat[C,R][T]) => mat[C,R][T],
}

operator :+, {
    must_use: true,
    const: "constantAdd",
    validate: "validateAdd",

    [T < Number].(T, T) => T,

    # vector addition
    [T < Number, N].(vec[N][T], T) => vec[N][T],
    [T < Number, N].(T, vec[N][T]) => vec[N][T],
    [T < Number, N].(vec[N][T], vec[N][T]) => vec[N][T],

    # matrix-matrix addition
    [T < Float, C, R].(mat[C,R][T], mat[C,R][T]) => mat[C,R][T],
}

operator :*, {
    must_use: true,
    const: "constantMultiply",
    validate: "validateMultiply",

    # binary
    [T < Number].(T, T) => T,

    # vector scaling
    [T < Number, N].(vec[N][T], T) => vec[N][T],
    [T < Number, N].(T, vec[N][T]) => vec[N][T],
    [T < Number, N].(vec[N][T], vec[N][T]) => vec[N][T],

    # matrix scaling
    [T < Number, C, R].(mat[C, R][T], T) => mat[C, R][T],
    [T < Number, C, R].(T, mat[C, R][T]) => mat[C, R][T],

    # matrix-vector multiplication
    [T < Float, C, R].(mat[C,R][T], vec[C][T]) => vec[R][T],
    [T < Float, C, R].(vec[R][T], mat[C,R][T]) => vec[C][T],

    # matrix-matrix multiplication
    [T < Float, C, R, K].(mat[K,R][T], mat[C,K][T]) => mat[C,R][T],
}

operator :/, {
    must_use: true,
    const: "constantDivide",
    validate: "validateDivide",

    [T < Number].(T, T) => T,

    # vector scaling
    [T < Number, N].(vec[N][T], T) => vec[N][T],
    [T < Number, N].(T, vec[N][T]) => vec[N][T],
    [T < Number, N].(vec[N][T], vec[N][T]) => vec[N][T],
}

operator :%, {
    must_use: true,
    const: "constantModulo",
    validate: "validateModulo",
    [T < Number].(T, T) => T,

    # vector scaling
    [T < Number, N].(vec[N][T], T) => vec[N][T],
    [T < Number, N].(T, vec[N][T]) => vec[N][T],
    [T < Number, N].(vec[N][T], vec[N][T]) => vec[N][T],
}

# 8.8. Comparison Expressions (https://www.w3.org/TR/WGSL/#comparison-expr)

{
    "==" => 'constantEqual',
    "!=" => 'constantNotEqual',
}.each do |op, const_function|
    operator :"#{op}", {
        must_use: true,
        const: const_function,

        [T < Scalar].(T, T) => bool,
        [T < Scalar, N].(vec[N][T], vec[N][T]) => vec[N][bool],
    }
end

{
    "<" => 'constantLt',
    "<=" => 'constantLtEq',
    ">" => 'constantGt',
    ">=" => 'constantGtEq',
}.each do |op, const_function|
    operator :"#{op}", {
        must_use: true,
        const: const_function,

        [T < Number].(T, T) => bool,
        [T < Number, N].(vec[N][T], vec[N][T]) => vec[N][bool],
    }
end

# 8.9. Bit Expressions (https://www.w3.org/TR/WGSL/#bit-expr)

operator :~, {
    must_use: true,
    const: 'constantBitwiseNot',

    [T < Integer].(T) => T,
    [T < Integer, N].(vec[N][T]) => vec[N][T]
}

{
    "|" => 'constantBitwiseOr',
    "&" => 'constantBitwiseAnd',
    "^" => 'constantBitwiseXor',
}.each do |op, const_function|
    operator :"#{op}", {
        must_use: true,
        const: const_function,

        [T < Integer].(T, T) => T,
        [T < Integer, N].(vec[N][T], vec[N][T]) => vec[N][T]
    }
end

{
    "<<" => ['constantBitwiseShiftLeft', 'validateBitwiseShiftLeft'],
    ">>" => ['constantBitwiseShiftRight', 'validateBitwiseShiftRight'],
}.each do |op, functions|
    const_function, validate_function = functions
    operator :"#{op}", {
        must_use: true,
        const: const_function,
        validate: validate_function,

        [S < Integer].(S, u32) => S,
        [S < Integer, N].(vec[N][S], vec[N][u32]) => vec[N][S],
    }
end

# 8.13. Address-Of Expression (https://www.w3.org/TR/WGSL/#address-of-expr)
# 8.14. Indirection Expression (https://www.w3.org/TR/WGSL/#indirection-expr)
# Implemented inline in the type checker

# 17.1. Constructor Built-in Functions

# 17.1.1. Zero Value Built-in Functions
constructor :bool, {
    must_use: true,
    const: true,

    [].() => bool,
}

constructor :i32, {
    must_use: true,
    const: true,

    [].() => i32,
}

constructor :u32, {
    must_use: true,
    const: true,

    [].() => u32,
}

constructor :f32, {
    must_use: true,
    const: true,

    [].() => f32,
}

constructor :f16, {
    must_use: true,
    const: true,

    [].() => f16,
}

constructor :vec2, {
    must_use: true,
    const: true,

    [T < ConcreteScalar].() => vec2[T],
}

constructor :vec3, {
    must_use: true,
    const: true,

    [T < ConcreteScalar].() => vec3[T],
}

constructor :vec4, {
    must_use: true,
    const: true,

    [T < ConcreteScalar].() => vec4[T],
}

(2..4).each do |columns|
    (2..4).each do |rows|
        constructor :"mat#{columns}x#{rows}", {
            must_use: true,
            const: true,

            [T < ConcreteFloat].() => mat[columns,rows][T],
        }
    end
end

# 17.1.2. Value Constructor Built-in Functions

# 17.1.2.1. array
# Implemented inline in the type checker

# 17.1.2.2.
constructor :bool, {
    must_use: true,
    const: true,

    [T < Scalar].(T) => bool,
}

# 17.1.2.3.
constructor :f16, {
    must_use: true,
    const: true,

    [T < Scalar].(T) => f16,
}

# 17.1.2.4.
constructor :f32, {
    must_use: true,
    const: true,

    [T < Scalar].(T) => f32,
}

# 17.1.2.5.
constructor :i32, {
    must_use: true,
    const: true,

    [T < Scalar].(T) => i32,
}

# 17.1.2.6 - 14: matCxR
(2..4).each do |columns|
    (2..4).each do |rows|
        constructor :"mat#{columns}x#{rows}", {
            must_use: true,
            const: true,

            [T < ConcreteFloat, S < Float].(mat[columns,rows][S]) => mat[columns,rows][T],
            [T < Float].(mat[columns,rows][T]) => mat[columns,rows][T],
            [T < Float].(*([T] * columns * rows)) => mat[columns,rows][T],
            [T < Float].(*([vec[rows][T]] * columns)) => mat[columns,rows][T],
        }
    end
end

# 17.1.2.15. Structures
# Implemented inline in the type checker

# 17.1.2.17.
constructor :u32, {
    must_use: true,
    const: true,

    [T < Scalar].(T) => u32,
}

# 17.1.2.17.
constructor :vec2, {
    must_use: true,
    const: true,

    [T < Scalar].(T) => vec2[T],
    [T < ConcreteScalar, S < Scalar].(vec2[S]) => vec2[T],
    [S < Scalar].(vec2[S]) => vec2[S],
    [T < Scalar].(T, T) => vec2[T],
    [].() => vec2[abstract_int],
}

# 17.1.2.18.
constructor :vec3, {
    must_use: true,
    const: true,

    [T < Scalar].(T) => vec3[T],
    [T < ConcreteScalar, S < Scalar].(vec3[S]) => vec3[T],
    [S < Scalar].(vec3[S]) => vec3[S],
    [T < Scalar].(T, T, T) => vec3[T],
    [T < Scalar].(vec2[T], T) => vec3[T],
    [T < Scalar].(T, vec2[T]) => vec3[T],
    [].() => vec3[abstract_int],
}

# 17.1.2.19.
constructor :vec4, {
    must_use: true,
    const: true,

    [T < Scalar].(T) => vec4[T],
    [T < ConcreteScalar, S < Scalar].(vec4[S]) => vec4[T],
    [S < Scalar].(vec4[S]) => vec4[S],
    [T < Scalar].(T, T, T, T) => vec4[T],
    [T < Scalar].(T, vec2[T], T) => vec4[T],
    [T < Scalar].(T, T, vec2[T]) => vec4[T],
    [T < Scalar].(vec2[T], T, T) => vec4[T],
    [T < Scalar].(vec2[T], vec2[T]) => vec4[T],
    [T < Scalar].(vec3[T], T) => vec4[T],
    [T < Scalar].(T, vec3[T]) => vec4[T],
    [].() => vec4[abstract_int],
}

# 17.2. Bit Reinterpretation Built-in Functions (https://www.w3.org/TR/WGSL/#bitcast-builtin)

# NOTE: Our overload resolution/constraints aren't expressive enough to support
# some of the bitcast overloads. They require a constraint on the type variable
# to constrain it to a vector type, which we cannot express here, so it's implemented
# inline in the type checker

# 17.3. Logical Built-in Functions (https://www.w3.org/TR/WGSL/#logical-builtin-functions)

# 17.3.1 & 17.3.2
["all", "any"].each do |op|
    function :"#{op}", {
        must_use: true,
        const: true,

        [N].(vec[N][bool]) => bool,
        [N].(bool) => bool,
    }
end

# 17.3.3
function :select, {
    must_use: true,
    const: true,

    [T < Scalar].(T, T, bool) => T,
    [T < Scalar, N].(vec[N][T], vec[N][T], bool) => vec[N][T],
    [T < Scalar, N].(vec[N][T], vec[N][T], vec[N][bool]) => vec[N][T],
}

# 17.4. Array Built-in Functions

# 17.4.1.
function :arrayLength, {
    must_use: true,

    [T].(ptr[storage, array[T], read]) => u32,
    [T].(ptr[storage, array[T], read_write]) => u32,
}

# 17.5. Numeric Built-in Functions (https://www.w3.org/TR/WGSL/#numeric-builtin-functions)

# Trigonometric
["acos", "asin", "atan", "cos", "sin", "tan",
 "acosh", "asinh", "atanh", "cosh", "sinh", "tanh"].each do |op|
    function :"#{op}", {
        must_use: true,
        const: true,

        [T < Float].(T) => T,
        [T < Float, N].(vec[N][T]) => vec[N][T],
    }
end

# 17.5.1
function :abs, {
    must_use: true,
    const: true,

    [T < Number].(T) => T,
    [T < Number, N].(vec[N][T]) => vec[N][T],
}

# 17.5.2. acos
# 17.5.3. acosh
# 17.5.4. asin
# 17.5.5. asinh
# 17.5.6. atan
# 17.5.7. atanh
# Defined in [Trigonometric]

# 17.5.8
function :atan2, {
    must_use: true,
    const: true,

    [T < Float].(T, T) => T,
    [T < Float, N].(vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.9
function :ceil, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.10
function :clamp, {
    must_use: true,
    const: true,
    validate: true,

    [T < Number].(T, T, T) => T,
    [T < Number, N].(vec[N][T], vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.11. cos
# 17.5.12. cosh
# Defined in [Trigonometric]

# 17.5.13-15 (Bit counting)
["countLeadingZeros", "countOneBits", "countTrailingZeros"].each do |op|
    function :"#{op}", {
        must_use: true,
        const: true,

        [T < ConcreteInteger].(T) => T,
        [T < ConcreteInteger, N].(vec[N][T]) => vec[N][T],
    }
end

# 17.5.16
function :cross, {
    must_use: true,
    const: true,

    [T < Float].(vec3[T], vec3[T]) => vec3[T],
}

# 17.5.17
function :degrees, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.18
function :determinant, {
    must_use: true,
    const: true,

    [T < Float, C].(mat[C,C][T]) => T,
}

# 17.5.19
function :distance, {
    must_use: true,
    const: true,

    [T < Float].(T, T) => T,
    [T < Float, N].(vec[N][T], vec[N][T]) => T,
}

# 17.5.20
function :dot, {
    must_use: true,
    const: true,

    [T < Number, N].(vec[N][T], vec[N][T]) => T
}

# 17.5.21
function :dot4U8Packed, {
    must_use: true,
    const: true,

    [].(u32, u32) => u32
}

# 17.5.22
function :dot4I8Packed, {
    must_use: true,
    const: true,

    [].(u32, u32) => i32
}

# 17.5.21 & 17.5.22
["exp", "exp2"].each do |op|
    function :"#{op}", {
        must_use: true,
        const: true,

        [T < Float].(T) => T,
        [T < Float, N].(vec[N][T]) => vec[N][T],
    }
end

# 17.5.23 & 17.5.24
function :extractBits, {
    must_use: true,
    const: true,

    # signed
    [].(i32, u32, u32) => i32,
    [N].(vec[N][i32], u32, u32) => vec[N][i32],

    # unsigned
    [].(u32, u32, u32) => u32,
    [N].(vec[N][u32], u32, u32) => vec[N][u32],
}

# 17.5.25
function :faceForward, {
    must_use: true,
    const: true,

    [T < Float, N].(vec[N][T], vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.26 & 17.5.27
function :firstLeadingBit, {
    must_use: true,
    const: true,

    # signed
    [].(i32) => i32,
    [N].(vec[N][i32]) => vec[N][i32],

    # unsigned
    [].(u32) => u32,
    [N].(vec[N][u32]) => vec[N][u32],
}

# 17.5.28
function :firstTrailingBit, {
    must_use: true,
    const: true,

    [T < ConcreteInteger].(T) => T,
    [T < ConcreteInteger, N].(vec[N][T]) => vec[N][T],
}

# 17.5.29
function :floor, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.30
function :fma, {
    must_use: true,
    const: true,

    [T < Float].(T, T, T) => T,
    [T < Float, N].(vec[N][T], vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.31
function :fract, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.32
function :frexp, {
    must_use: true,
    const: true,

    [].(f32) => __frexp_result_f32,
    [].(f16) => __frexp_result_f16,
    [].(abstract_float) => __frexp_result_abstract,

    [].(vec2[f32]) => __frexp_result_vec2_f32,
    [].(vec2[f16]) => __frexp_result_vec2_f16,
    [].(vec2[abstract_float]) => __frexp_result_vec2_abstract,

    [].(vec3[f32]) => __frexp_result_vec3_f32,
    [].(vec3[f16]) => __frexp_result_vec3_f16,
    [].(vec3[abstract_float]) => __frexp_result_vec3_abstract,

    [].(vec4[f32]) => __frexp_result_vec4_f32,
    [].(vec4[f16]) => __frexp_result_vec4_f16,
    [].(vec4[abstract_float]) => __frexp_result_vec4_abstract,
}

# 17.5.33
function :insertBits, {
    must_use: true,
    const: true,

    [T < ConcreteInteger].(T, T, u32, u32) => T,
    [T < ConcreteInteger, N].(vec[N][T], vec[N][T], u32, u32) => vec[N][T],
}

# 17.5.34
function :inverseSqrt, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.35
function :ldexp, {
    must_use: true,
    const: true,
    validate: true,

    [T < ConcreteFloat].(T, i32) => T,
    [].(abstract_float, abstract_int) => abstract_float,
    [].(abstract_float, i32) => abstract_float,
    [T < ConcreteFloat, N].(vec[N][T], vec[N][i32]) => vec[N][T],
    [N].(vec[N][abstract_float], vec[N][abstract_int]) => vec[N][abstract_float],
    [N].(vec[N][abstract_float], vec[N][i32]) => vec[N][abstract_float],
}

# 17.5.36
function :length, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => T,
}

# 17.5.37 & 17.5.38
["log", "log2"].each do |op|
    function :"#{op}", {
        must_use: true,
        const: true,

        [T < Float].(T) => T,
        [T < Float, N].(vec[N][T]) => vec[N][T],
    }
end

# 17.5.39
function :max, {
    must_use: true,
    const: true,

    [T < Number].(T, T) => T,
    [T < Number, N].(vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.40
function :min, {
    must_use: true,
    const: true,

    [T < Number].(T, T) => T,
    [T < Number, N].(vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.41
function :mix, {
    must_use: true,
    const: true,

    [T < Float].(T, T, T) => T,
    [T < Float, N].(vec[N][T], vec[N][T], vec[N][T]) => vec[N][T],
    [T < Float, N].(vec[N][T], vec[N][T], T) => vec[N][T],
}

# 17.5.42
function :modf, {
    must_use: true,
    const: true,

    [].(f32) => __modf_result_f32,
    [].(f16) => __modf_result_f16,
    [].(abstract_float) => __modf_result_abstract,

    [].(vec2[f32]) => __modf_result_vec2_f32,
    [].(vec2[f16]) => __modf_result_vec2_f16,
    [].(vec2[abstract_float]) => __modf_result_vec2_abstract,

    [].(vec3[f32]) => __modf_result_vec3_f32,
    [].(vec3[f16]) => __modf_result_vec3_f16,
    [].(vec3[abstract_float]) => __modf_result_vec3_abstract,

    [].(vec4[f32]) => __modf_result_vec4_f32,
    [].(vec4[f16]) => __modf_result_vec4_f16,
    [].(vec4[abstract_float]) => __modf_result_vec4_abstract,
}

# 17.5.43
function :normalize, {
    must_use: true,
    const: true,

    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.44
function :pow, {
    must_use: true,
    const: true,

    [T < Float].(T, T) => T,
    [T < Float, N].(vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.45
function :quantizeToF16, {
    must_use: true,
    const: true,

    [].(f32) => f32,
    [N].(vec[N][f32]) => vec[N][f32],
}

# 17.5.46
function :radians, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.47
function :reflect, {
    must_use: true,
    const: true,

    [T < Float, N].(vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.48
function :refract, {
    must_use: true,
    const: true,

    [T < Float, N].(vec[N][T], vec[N][T], T) => vec[N][T],
}

# 17.5.49
function :reverseBits, {
    must_use: true,
    const: true,

    [T < ConcreteInteger].(T) => T,
    [T < ConcreteInteger, N].(vec[N][T]) => vec[N][T],
}

# 17.5.50
function :round, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.51
function :saturate, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.52
function :sign, {
    must_use: true,
    const: true,

    [T < SignedNumber].(T) => T,
    [T < SignedNumber, N].(vec[N][T]) => vec[N][T],
}

# 17.5.53. sin
# 17.5.54. sinh
# Defined in [Trigonometric]

# 17.5.55
function :smoothstep, {
    must_use: true,
    const: true,
    validate: true,

    [T < Float].(T, T, T) => T,
    [T < Float, N].(vec[N][T], vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.56
function :sqrt, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.5.57
function :step, {
    must_use: true,
    const: true,

    [T < Float].(T, T) => T,
    [T < Float, N].(vec[N][T], vec[N][T]) => vec[N][T],
}

# 17.5.58. tan
# 17.5.59. tanh
# Defined in [Trigonometric]

# 17.5.60
function :transpose, {
    must_use: true,
    const: true,

    [T < Float, C, R].(mat[C,R][T]) => mat[R,C][T],
}

# 17.5.61
function :trunc, {
    must_use: true,
    const: true,

    [T < Float].(T) => T,
    [T < Float, N].(vec[N][T]) => vec[N][T],
}

# 17.6. Derivative Built-in Functions (https://www.w3.org/TR/WGSL/#derivative-builtin-functions)
[
    # 17.6.1
    :dpdx,
    # 17.6.2
    :dpdxCoarse,
    # 17.6.3
    :dpdxFine,
    # 17.6.4
    :dpdy,
    # 17.6.5
    :dpdyCoarse,
    # 17.6.6
    :dpdyFine,
    # 17.6.7
    :fwidth,
    # 17.6.8
    :fwidthCoarse,
    # 17.6.9
    :fwidthFine,
]. each do |op|
    function op, {
        must_use: true,
        stage: :fragment,

        [].(f32) => f32,
        [N].(vec[N][f32]) => vec[N][f32],
    }
end

# 17.7. Texture Built-in Functions (https://gpuweb.github.io/gpuweb/wgsl/#texture-builtin-functions)

# 17.7.1
function :textureDimensions, {
    must_use: true,

    # ST is i32, u32, or f32
    # F is a texel format
    # A is an access mode
    # T is texture_1d<ST> or texture_storage_1d<F,A>
    # @must_use fn textureDimensions(t: T) -> u32
    [S < Concrete32BitNumber].(texture_1d[S]) => u32,
    [F, AM].(texture_storage_1d[F, AM]) => u32,

    # ST is i32, u32, or f32
    # T is texture_1d<ST>
    # L is i32, or u32
    # @must_use fn textureDimensions(t: T, level: L) -> u32
    [S < Concrete32BitNumber, T < ConcreteInteger].(texture_1d[S], T) => u32,

    # ST is i32, u32, or f32
    # F is a texel format
    # A is an access mode
    # T is texture_2d<ST>, texture_2d_array<ST>, texture_cube<ST>, texture_cube_array<ST>, texture_multisampled_2d<ST>, texture_depth_2d, texture_depth_2d_array, texture_depth_cube, texture_depth_cube_array, texture_depth_multisampled_2d, texture_storage_2d<F,A>, texture_storage_2d_array<F,A>, or texture_external
    # @must_use fn textureDimensions(t: T) -> vec2<u32>
    [S < Concrete32BitNumber].(texture_2d[S]) => vec2[u32],
    [S < Concrete32BitNumber].(texture_2d_array[S]) => vec2[u32],
    [S < Concrete32BitNumber].(texture_cube[S]) => vec2[u32],
    [S < Concrete32BitNumber].(texture_cube_array[S]) => vec2[u32],
    [S < Concrete32BitNumber].(texture_multisampled_2d[S]) => vec2[u32],
    [].(texture_depth_2d) => vec2[u32],
    [].(texture_depth_2d_array) => vec2[u32],
    [].(texture_depth_cube) => vec2[u32],
    [].(texture_depth_cube_array) => vec2[u32],
    [].(texture_depth_multisampled_2d) => vec2[u32],
    [F, AM].(texture_storage_2d[F, AM]) => vec2[u32],
    [F, AM].(texture_storage_2d_array[F, AM]) => vec2[u32],
    [].(texture_external) => vec2[u32],

    # ST is i32, u32, or f32
    # T is texture_2d<ST>, texture_2d_array<ST>, texture_cube<ST>, texture_cube_array<ST>, texture_depth_2d, texture_depth_2d_array, texture_depth_cube, or texture_depth_cube_array
    # L is i32, or u32
    # @must_use fn textureDimensions(t: T, level: L) -> vec2<u32>
    [S < Concrete32BitNumber, T < ConcreteInteger].(texture_2d[S], T) => vec2[u32],
    [S < Concrete32BitNumber, T < ConcreteInteger].(texture_2d_array[S], T) => vec2[u32],
    [S < Concrete32BitNumber, T < ConcreteInteger].(texture_cube[S], T) => vec2[u32],
    [S < Concrete32BitNumber, T < ConcreteInteger].(texture_cube_array[S], T) => vec2[u32],
    [T < ConcreteInteger].(texture_depth_2d, T) => vec2[u32],
    [T < ConcreteInteger].(texture_depth_2d_array, T) => vec2[u32],
    [T < ConcreteInteger].(texture_depth_cube, T) => vec2[u32],
    [T < ConcreteInteger].(texture_depth_cube_array, T) => vec2[u32],

    # ST is i32, u32, or f32
    # F is a texel format
    # A is an access mode
    # T is texture_3d<ST> or texture_storage_3d<F,A>
    # @must_use fn textureDimensions(t: T) -> vec3<u32>
    [S < Concrete32BitNumber].(texture_3d[S]) => vec3[u32],
    [F, AM].(texture_storage_3d[F, AM]) => vec3[u32],

    # ST is i32, u32, or f32
    # T is texture_3d<ST>
    # L is i32, or u32
    # @must_use fn textureDimensions(t: T, level: L) -> vec3<u32>
    [S < Concrete32BitNumber, T < ConcreteInteger].(texture_3d[S], T) => vec3[u32],
}

# 17.7.2
function :textureGather, {
    must_use: true,

    [T < ConcreteInteger, S < Concrete32BitNumber].(T, texture_2d[S], sampler, vec2[f32]) => vec4[S],

    [T < ConcreteInteger, S < Concrete32BitNumber].(T, texture_2d[S], sampler, vec2[f32], vec2[i32]) => vec4[S],

    [T < ConcreteInteger, S < Concrete32BitNumber, U < ConcreteInteger].(T, texture_2d_array[S], sampler, vec2[f32], U) => vec4[S],

    [T < ConcreteInteger, S < Concrete32BitNumber, U < ConcreteInteger].(T, texture_2d_array[S], sampler, vec2[f32], U, vec2[i32]) => vec4[S],

    [T < ConcreteInteger, S < Concrete32BitNumber].(T, texture_cube[S], sampler, vec3[f32]) => vec4[S],

    [T < ConcreteInteger, S < Concrete32BitNumber, U < ConcreteInteger].(T, texture_cube_array[S], sampler, vec3[f32], U) => vec4[S],

    # @must_use fn textureGather(t: texture_depth_2d, s: sampler, coords: vec2<f32>) -> vec4<f32>
    [].(texture_depth_2d, sampler, vec2[f32]) => vec4[f32],

    # @must_use fn textureGather(t: texture_depth_2d, s: sampler, coords: vec2<f32>, offset: vec2<i32>) -> vec4<f32>
    [].(texture_depth_2d, sampler, vec2[f32], vec2[i32]) => vec4[f32],

    # @must_use fn textureGather(t: texture_depth_cube, s: sampler, coords: vec3<f32>) -> vec4<f32>
    [].(texture_depth_cube, sampler, vec3[f32]) => vec4[f32],

    # A is i32, or u32
    # @must_use fn textureGather(t: texture_depth_2d_array, s: sampler, coords: vec2<f32>, array_index: A) -> vec4<f32>
    [U < ConcreteInteger].(texture_depth_2d_array, sampler, vec2[f32], U) => vec4[f32],

    # A is i32, or u32
    # @must_use fn textureGather(t: texture_depth_2d_array, s: sampler, coords: vec2<f32>, array_index: A, offset: vec2<i32>) -> vec4<f32>
    [U < ConcreteInteger].(texture_depth_2d_array, sampler, vec2[f32], U, vec2[i32]) => vec4[f32],

    # A is i32, or u32
    # @must_use fn textureGather(t: texture_depth_cube_array, s: sampler, coords: vec3<f32>, array_index: A) -> vec4<f32>
    [U < ConcreteInteger].(texture_depth_cube_array, sampler, vec3[f32], U) => vec4[f32],
}

# 17.7.3
function :textureGatherCompare, {
    must_use: true,

    # @must_use fn textureGatherCompare(t: texture_depth_2d, s: sampler_comparison, coords: vec2<f32>, depth_ref: f32) -> vec4<f32>
    [].(texture_depth_2d, sampler_comparison, vec2[f32], f32) => vec4[f32],

    # @must_use fn textureGatherCompare(t: texture_depth_2d, s: sampler_comparison, coords: vec2<f32>, depth_ref: f32, offset: vec2<i32>) -> vec4<f32>
    [].(texture_depth_2d, sampler_comparison, vec2[f32], f32, vec2[i32]) => vec4[f32],

    # A is i32, or u32
    # @must_use fn textureGatherCompare(t: texture_depth_2d_array, s: sampler_comparison, coords: vec2<f32>, array_index: A, depth_ref: f32) -> vec4<f32>
    [T < ConcreteInteger].(texture_depth_2d_array, sampler_comparison, vec2[f32], T, f32) => vec4[f32],

    # A is i32, or u32
    # @must_use fn textureGatherCompare(t: texture_depth_2d_array, s: sampler_comparison, coords: vec2<f32>, array_index: A, depth_ref: f32, offset: vec2<i32>) -> vec4<f32>
    [T < ConcreteInteger].(texture_depth_2d_array, sampler_comparison, vec2[f32], T, f32, vec2[i32]) => vec4[f32],

    # @must_use fn textureGatherCompare(t: texture_depth_cube, s: sampler_comparison, coords: vec3<f32>, depth_ref: f32) -> vec4<f32>
    [].(texture_depth_cube, sampler_comparison, vec3[f32], f32) => vec4[f32],

    # A is i32, or u32
    # @must_use fn textureGatherCompare(t: texture_depth_cube_array, s: sampler_comparison, coords: vec3<f32>, array_index: A, depth_ref: f32) -> vec4<f32>
    [T < ConcreteInteger].(texture_depth_cube_array, sampler_comparison, vec3[f32], T, f32) => vec4[f32],
}

# 17.7.4
function :textureLoad, {
    must_use: true,

    [T < ConcreteInteger, U < ConcreteInteger, S < Concrete32BitNumber].(texture_1d[S], T, U) => vec4[S],
    [F, T < ConcreteInteger, U < ConcreteInteger, S < Concrete32BitNumber].(texture_storage_1d[F, read], T) => vec4[ChannelFormat[F]],
    [F, T < ConcreteInteger, U < ConcreteInteger, S < Concrete32BitNumber].(texture_storage_1d[F, read_write], T) => vec4[ChannelFormat[F]],
    [T < ConcreteInteger, U < ConcreteInteger, S < Concrete32BitNumber].(texture_2d[S], vec2[T], U) => vec4[S],
    [T < ConcreteInteger, V < ConcreteInteger, U < ConcreteInteger, S < Concrete32BitNumber].(texture_2d_array[S], vec2[T], V, U) => vec4[S],
    [T < ConcreteInteger, U < ConcreteInteger, S < Concrete32BitNumber].(texture_3d[S], vec3[T], U) => vec4[S],
    [T < ConcreteInteger, U < ConcreteInteger, S < Concrete32BitNumber].(texture_multisampled_2d[S], vec2[T], U) => vec4[S],


    # C is i32, or u32
    # L is i32, or u32
    # @must_use fn textureLoad(t: texture_depth_2d, coords: vec2<C>, level: L) -> f32
    [T < ConcreteInteger, U < ConcreteInteger].(texture_depth_2d, vec2[T], U) => f32,

    # C is i32, or u32
    # A is i32, or u32
    # L is i32, or u32
    # @must_use fn textureLoad(t: texture_depth_2d_array, coords: vec2<C>, array_index: A, level: L) -> f32
    [T < ConcreteInteger, S < ConcreteInteger, U < ConcreteInteger].(texture_depth_2d_array, vec2[T], S, U) => f32,

    # C is i32, or u32
    # S is i32, or u32
    # @must_use fn textureLoad(t: texture_depth_multisampled_2d, coords: vec2<C>, sample_index: S)-> f32
    [T < ConcreteInteger, U < ConcreteInteger].(texture_depth_multisampled_2d, vec2[T], U) => f32,

    [T < ConcreteInteger].(texture_external, vec2[T]) => vec4[f32],

    # F is a texel format
    # AM is the access mode
    # C is i32, or u32
    # CF depends on the storage texel format F. See the texel format table for the mapping of texel format to channel format.
    # fn textureLoad(t: texture_storage_2d<F,AM>, coords: vec2<C>) -> vec4<CF>
    [F, AM, T < ConcreteInteger].(texture_storage_2d[F, AM], vec2[T]) => vec4[ChannelFormat[F]],

    # F is a texel format
    # AM is the access mode
    # C is i32, or u32
    # A is i32, or u32
    # CF depends on the storage texel format F. See the texel format table for the mapping of texel format to channel format.
    # fn textureLoad(t: texture_storage_2d_array<F,AM>, coords: vec2<C>, array_index: A) -> vec4<CF>
    [F, AM, T < ConcreteInteger, S < ConcreteInteger].(texture_storage_2d_array[F, AM], vec2[T], S) => vec4[ChannelFormat[F]],

    # F is a texel format
    # AM is the access mode
    # C is i32, or u32
    # CF depends on the storage texel format F. See the texel format table for the mapping of texel format to channel format.
    # fn textureLoad(t: texture_storage_3d<F,AM>, coords: vec2<C>) -> vec4<CF>
    [F, AM, T < ConcreteInteger].(texture_storage_3d[F, AM], vec3[T]) => vec4[ChannelFormat[F]],
}

# 17.7.5
function :textureNumLayers, {
    must_use: true,

    # F is a texel format
    # A is an access mode
    # ST is i32, u32, or f32
    # T is texture_2d_array<ST>, texture_cube_array<ST>, texture_depth_2d_array, texture_depth_cube_array, or texture_storage_2d_array<F,A>
    # @must_use fn textureNumLayers(t: T) -> u32
    [S < Concrete32BitNumber].(texture_2d_array[S]) => u32,
    [S < Concrete32BitNumber].(texture_cube_array[S]) => u32,
    [].(texture_depth_2d_array) => u32,
    [].(texture_depth_cube_array) => u32,
    [F, AM].(texture_storage_2d_array[F, AM]) => u32,
}

# 17.7.6
function :textureNumLevels, {
    must_use: true,

    # ST is i32, u32, or f32
    # T is texture_1d<ST>, texture_2d<ST>, texture_2d_array<ST>, texture_3d<ST>, texture_cube<ST>, texture_cube_array<ST>, texture_depth_2d, texture_depth_2d_array, texture_depth_cube, or texture_depth_cube_array
    # @must_use fn textureNumLevels(t: T) -> u32
    [S < Concrete32BitNumber].(texture_1d[S]) => u32,
    [S < Concrete32BitNumber].(texture_2d[S]) => u32,
    [S < Concrete32BitNumber].(texture_2d_array[S]) => u32,
    [S < Concrete32BitNumber].(texture_3d[S]) => u32,
    [S < Concrete32BitNumber].(texture_cube[S]) => u32,
    [S < Concrete32BitNumber].(texture_cube_array[S]) => u32,
    [].(texture_depth_2d) => u32,
    [].(texture_depth_2d_array) => u32,
    [].(texture_depth_cube) => u32,
    [].(texture_depth_cube_array) => u32,
}

# 17.7.7
function :textureNumSamples, {
    must_use: true,

    # ST is i32, u32, or f32
    # T is texture_multisampled_2d<ST> or texture_depth_multisampled_2d
    # @must_use fn textureNumSamples(t: T) -> u32
    [S < Concrete32BitNumber].(texture_multisampled_2d[S]) => u32,
    [].(texture_depth_multisampled_2d) => u32,
}

# 17.7.8
function :textureSample, {
    must_use: true,
    stage: :fragment,

    [].(texture_1d[f32], sampler, f32) => vec4[f32],

    [].(texture_2d[f32], sampler, vec2[f32]) => vec4[f32],

    [].(texture_2d[f32], sampler, vec2[f32], vec2[i32]) => vec4[f32],

    [T < ConcreteInteger].(texture_2d_array[f32], sampler, vec2[f32], T) => vec4[f32],

    [T < ConcreteInteger].(texture_2d_array[f32], sampler, vec2[f32], T, vec2[i32]) => vec4[f32],

    [].(texture_3d[f32], sampler, vec3[f32]) => vec4[f32],
    [].(texture_cube[f32], sampler, vec3[f32]) => vec4[f32],

    [].(texture_3d[f32], sampler, vec3[f32], vec3[i32]) => vec4[f32],

    [T < ConcreteInteger].(texture_cube_array[f32], sampler, vec3[f32], T) => vec4[f32],

    # @must_use fn textureSample(t: texture_depth_2d, s: sampler, coords: vec2<f32>) -> f32
    [].(texture_depth_2d, sampler, vec2[f32]) => f32,

    # @must_use fn textureSample(t: texture_depth_2d, s: sampler, coords: vec2<f32>, offset: vec2<i32>) -> f32
    [].(texture_depth_2d, sampler, vec2[f32], vec2[i32]) => f32,

    # A is i32, or u32
    # @must_use fn textureSample(t: texture_depth_2d_array, s: sampler, coords: vec2<f32>, array_index: A) -> f32
    [T < ConcreteInteger].(texture_depth_2d_array, sampler, vec2[f32], T) => f32,

    # A is i32, or u32
    # @must_use fn textureSample(t: texture_depth_2d_array, s: sampler, coords: vec2<f32>, array_index: A, offset: vec2<i32>) -> f32
    [T < ConcreteInteger].(texture_depth_2d_array, sampler, vec2[f32], T, vec2[i32]) => f32,

    # @must_use fn textureSample(t: texture_depth_cube, s: sampler, coords: vec3<f32>) -> f32
    [].(texture_depth_cube, sampler, vec3[f32]) => f32,

    # A is i32, or u32
    # @must_use fn textureSample(t: texture_depth_cube_array, s: sampler, coords: vec3<f32>, array_index: A) -> f32
    [T < ConcreteInteger].(texture_depth_cube_array, sampler, vec3[f32], T) => f32,
}

# 17.7.9
function :textureSampleBias, {
    must_use: true,
    stage: :fragment,

    [].(texture_2d[f32], sampler, vec2[f32], f32) => vec4[f32],

    [].(texture_2d[f32], sampler, vec2[f32], f32, vec2[i32]) => vec4[f32],

    [T < ConcreteInteger].(texture_2d_array[f32], sampler, vec2[f32], T, f32) => vec4[f32],

    [T < ConcreteInteger].(texture_2d_array[f32], sampler, vec2[f32], T, f32, vec2[i32]) => vec4[f32],

    [].(texture_3d[f32], sampler, vec3[f32], f32) => vec4[f32],
    [].(texture_cube[f32], sampler, vec3[f32], f32) => vec4[f32],

    [].(texture_3d[f32], sampler, vec3[f32], f32, vec3[i32]) => vec4[f32],

    [T < ConcreteInteger].(texture_cube_array[f32], sampler, vec3[f32], T, f32) => vec4[f32],
}

# 17.7.10
function :textureSampleCompare, {
    must_use: true,
    stage: :fragment,

    # @must_use fn textureSampleCompare(t: texture_depth_2d, s: sampler_comparison, coords: vec2<f32>, depth_ref: f32) -> f32
    [].(texture_depth_2d, sampler_comparison, vec2[f32], f32) => f32,

    # @must_use fn textureSampleCompare(t: texture_depth_2d, s: sampler_comparison, coords: vec2<f32>, depth_ref: f32, offset: vec2<i32>) -> f32
    [].(texture_depth_2d, sampler_comparison, vec2[f32], f32, vec2[i32]) => f32,

    # A is i32, or u32
    # @must_use fn textureSampleCompare(t: texture_depth_2d_array, s: sampler_comparison, coords: vec2<f32>, array_index: A, depth_ref: f32) -> f32
    [T < ConcreteInteger].(texture_depth_2d_array, sampler_comparison, vec2[f32], T, f32) => f32,

    # A is i32, or u32
    # @must_use fn textureSampleCompare(t: texture_depth_2d_array, s: sampler_comparison, coords: vec2<f32>, array_index: A, depth_ref: f32, offset: vec2<i32>) -> f32
    [T < ConcreteInteger].(texture_depth_2d_array, sampler_comparison, vec2[f32], T, f32, vec2[i32]) => f32,

    # @must_use fn textureSampleCompare(t: texture_depth_cube, s: sampler_comparison, coords: vec3<f32>, depth_ref: f32) -> f32
    [].(texture_depth_cube, sampler_comparison, vec3[f32], f32) => f32,

    # A is i32, or u32
    # @must_use fn textureSampleCompare(t: texture_depth_cube_array, s: sampler_comparison, coords: vec3<f32>, array_index: A, depth_ref: f32) -> f32
    [T < ConcreteInteger].(texture_depth_cube_array, sampler_comparison, vec3[f32], T, f32) => f32,
}

# 17.7.11
function :textureSampleCompareLevel, {
    must_use: true,

    # @must_use fn textureSampleCompareLevel(t: texture_depth_2d, s: sampler_comparison, coords: vec2<f32>, depth_ref: f32) -> f32
    [].(texture_depth_2d, sampler_comparison, vec2[f32], f32) => f32,

    # @must_use fn textureSampleCompareLevel(t: texture_depth_2d, s: sampler_comparison, coords: vec2<f32>, depth_ref: f32, offset: vec2<i32>) -> f32
    [].(texture_depth_2d, sampler_comparison, vec2[f32], f32, vec2[i32]) => f32,

    # A is i32, or u32
    # @must_use fn textureSampleCompareLevel(t: texture_depth_2d_array, s: sampler_comparison, coords: vec2<f32>, array_index: A, depth_ref: f32) -> f32
    [T < ConcreteInteger].(texture_depth_2d_array, sampler_comparison, vec2[f32], T, f32) => f32,

    # A is i32, or u32
    # @must_use fn textureSampleCompareLevel(t: texture_depth_2d_array, s: sampler_comparison, coords: vec2<f32>, array_index: A, depth_ref: f32, offset: vec2<i32>) -> f32
    [T < ConcreteInteger].(texture_depth_2d_array, sampler_comparison, vec2[f32], T, f32, vec2[i32]) => f32,

    # @must_use fn textureSampleCompareLevel(t: texture_depth_cube, s: sampler_comparison, coords: vec3<f32>, depth_ref: f32) -> f32
    [].(texture_depth_cube, sampler_comparison, vec3[f32], f32) => f32,

    # A is i32, or u32
    # @must_use fn textureSampleCompareLevel(t: texture_depth_cube_array, s: sampler_comparison, coords: vec3<f32>, array_index: A, depth_ref: f32) -> f32
    [T < ConcreteInteger].(texture_depth_cube_array, sampler_comparison, vec3[f32], T, f32) => f32,
}

# 17.7.12
function :textureSampleGrad, {
    must_use: true,

    [].(texture_2d[f32], sampler, vec2[f32], vec2[f32], vec2[f32]) => vec4[f32],

    [].(texture_2d[f32], sampler, vec2[f32], vec2[f32], vec2[f32], vec2[i32]) => vec4[f32],

    [T < ConcreteInteger].(texture_2d_array[f32], sampler, vec2[f32], T, vec2[f32], vec2[f32]) => vec4[f32],

    [T < ConcreteInteger].(texture_2d_array[f32], sampler, vec2[f32], T, vec2[f32], vec2[f32], vec2[i32]) => vec4[f32],

    [].(texture_3d[f32], sampler, vec3[f32], vec3[f32], vec3[f32]) => vec4[f32],
    [].(texture_cube[f32], sampler, vec3[f32], vec3[f32], vec3[f32]) => vec4[f32],

    [].(texture_3d[f32], sampler, vec3[f32], vec3[f32], vec3[f32], vec3[i32]) => vec4[f32],

    [T < ConcreteInteger].(texture_cube_array[f32], sampler, vec3[f32], T, vec3[f32], vec3[f32]) => vec4[f32],
}

# 17.7.13
function :textureSampleLevel, {
    must_use: true,

    [].(texture_1d[f32], sampler, f32, f32) => vec4[f32],

    [].(texture_2d[f32], sampler, vec2[f32], f32) => vec4[f32],

    [].(texture_2d[f32], sampler, vec2[f32], f32, vec2[i32]) => vec4[f32],

    [T < ConcreteInteger].(texture_2d_array[f32], sampler, vec2[f32], T, f32) => vec4[f32],

    [T < ConcreteInteger].(texture_2d_array[f32], sampler, vec2[f32], T, f32, vec2[i32]) => vec4[f32],

    [].(texture_3d[f32], sampler, vec3[f32], f32) => vec4[f32],
    [].(texture_cube[f32], sampler, vec3[f32], f32) => vec4[f32],

    [].(texture_3d[f32], sampler, vec3[f32], f32, vec3[i32]) => vec4[f32],

    [T < ConcreteInteger].(texture_cube_array[f32], sampler, vec3[f32], T, f32) => vec4[f32],

    # L is i32, or u32
    # @must_use fn textureSampleLevel(t: texture_depth_2d, s: sampler, coords: vec2<f32>, level: L) -> f32
    [T < ConcreteInteger].(texture_depth_2d, sampler, vec2[f32], T) => f32,

    # L is i32, or u32
    # @must_use fn textureSampleLevel(t: texture_depth_2d, s: sampler, coords: vec2<f32>, level: L, offset: vec2<i32>) -> f32
    [T < ConcreteInteger].(texture_depth_2d, sampler, vec2[f32], T, vec2[i32]) => f32,

    # A is i32, or u32
    # L is i32, or u32
    # @must_use fn textureSampleLevel(t: texture_depth_2d_array, s: sampler, coords: vec2<f32>, array_index: A, level: L) -> f32
    [S < ConcreteInteger, T < ConcreteInteger].(texture_depth_2d_array, sampler, vec2[f32], S, T) => f32,

    # A is i32, or u32
    # L is i32, or u32
    # @must_use fn textureSampleLevel(t: texture_depth_2d_array, s: sampler, coords: vec2<f32>, array_index: A, level: L, offset: vec2<i32>) -> f32
    [S < ConcreteInteger, T < ConcreteInteger].(texture_depth_2d_array, sampler, vec2[f32], S, T, vec2[i32]) => f32,

    # L is i32, or u32
    # @must_use fn textureSampleLevel(t: texture_depth_cube, s: sampler, coords: vec3<f32>, level: L) -> f32
    [T < ConcreteInteger].(texture_depth_cube, sampler, vec3[f32], T) => f32,

    # A is i32, or u32
    # L is i32, or u32
    # @must_use fn textureSampleLevel(t: texture_depth_cube_array, s: sampler, coords: vec3<f32>, array_index: A, level: L) -> f32
    [S < ConcreteInteger, T < ConcreteInteger].(texture_depth_cube_array, sampler, vec3[f32], S, T) => f32,
}

# 17.7.14
function :textureSampleBaseClampToEdge, {
    must_use: true,

    [].(texture_external, sampler, vec2[f32]) => vec4[f32],
    [].(texture_2d[f32], sampler, vec2[f32]) => vec4[f32],
}

# 17.7.15 textureStore
function :textureStore, {
    # F is a texel format
    # C is i32, or u32
    # CF depends on the storage texel format F. See the texel format table for the mapping of texel format to channel format.
    # fn textureStore(t: texture_storage_1d<F,write>, coords: C, value: vec4<CF>)
    [F, T < ConcreteInteger].(texture_storage_1d[F, write], T, vec4[ChannelFormat[F]]) => void,
    [F, T < ConcreteInteger].(texture_storage_1d[F, read_write], T, vec4[ChannelFormat[F]]) => void,

    # F is a texel format
    # C is i32, or u32
    # CF depends on the storage texel format F. See the texel format table for the mapping of texel format to channel format.
    # fn textureStore(t: texture_storage_2d<F,write>, coords: vec2<C>, value: vec4<CF>)
    [F, T < ConcreteInteger].(texture_storage_2d[F, write], vec2[T], vec4[ChannelFormat[F]]) => void,
    [F, T < ConcreteInteger].(texture_storage_2d[F, read_write], vec2[T], vec4[ChannelFormat[F]]) => void,

    # F is a texel format
    # C is i32, or u32
    # A is i32, or u32
    # CF depends on the storage texel format F. See the texel format table for the mapping of texel format to channel format.
    # fn textureStore(t: texture_storage_2d_array<F,write>, coords: vec2<C>, array_index: A, value: vec4<CF>)
    [F, T < ConcreteInteger, S < ConcreteInteger].(texture_storage_2d_array[F, write], vec2[T], S, vec4[ChannelFormat[F]]) => void,
    [F, T < ConcreteInteger, S < ConcreteInteger].(texture_storage_2d_array[F, read_write], vec2[T], S, vec4[ChannelFormat[F]]) => void,

    # F is a texel format
    # C is i32, or u32
    # CF depends on the storage texel format F. See the texel format table for the mapping of texel format to channel format.
    # fn textureStore(t: texture_storage_3d<F,write>, coords: vec3<C>, value: vec4<CF>)
    [F, T < ConcreteInteger].(texture_storage_3d[F, write], vec3[T], vec4[ChannelFormat[F]]) => void,
    [F, T < ConcreteInteger].(texture_storage_3d[F, read_write], vec3[T], vec4[ChannelFormat[F]]) => void,
}

# 17.8. Atomic Built-in Functions (https://www.w3.org/TR/WGSL/#atomic-builtin-functions)

# 17.8.1
function :atomicLoad, {
    stage: [:fragment, :compute],

    # fn atomicLoad(atomic_ptr: ptr<AS, atomic<T>, read_write>) -> T
    [AS, T].(ptr[AS, atomic[T], read_write]) => T,
}


# 17.8.2
function :atomicStore, {
    stage: [:fragment, :compute],

    # fn atomicStore(atomic_ptr: ptr<AS, atomic<T>, read_write>, v: T)
    [AS, T].(ptr[AS, atomic[T], read_write], T) => void,
}

# 17.8.3. Atomic Read-modify-write (this spec entry contains several functions)
[
    :atomicAdd,
    :atomicSub,
    :atomicMax,
    :atomicMin,
    :atomicAnd,
    :atomicOr,
    :atomicXor,
    :atomicExchange,
].each do |op|
    function op, {
        stage: [:fragment, :compute],

        # fn #{op}(atomic_ptr: ptr<AS, atomic<T>, read_write>, v: T) -> T
        [AS, T].(ptr[AS, atomic[T], read_write], T) => T,
    }
end

function :atomicCompareExchangeWeak, {
    [AS].(ptr[AS, atomic[i32], read_write], i32, i32) => __atomic_compare_exchange_result_i32,
    [AS].(ptr[AS, atomic[u32], read_write], u32, u32) => __atomic_compare_exchange_result_u32,
}

# 17.9. Data Packing Built-in Functions (https://www.w3.org/TR/WGSL/#pack-builtin-functions)

# 17.9.1
function :pack4x8snorm, {
    # @const @must_use fn pack4x8snorm(e: vec4<f32>) -> u32
    const: true,
    must_use: true,
    [].(vec4[f32]) => u32,
}

# 17.9.2
function :pack4x8unorm, {
    # @const @must_use fn pack4x8unorm(e: vec4<f32>) -> u32
    const: true,
    must_use: true,
    [].(vec4[f32]) => u32,
}

# 17.9.3
function :pack4xI8, {
    # @const @must_use fn pack4xI8(e: vec4<i32>) -> u32
    const: true,
    must_use: true,
    [].(vec4[i32]) => u32,
}

# 17.9.4
function :pack4xU8, {
    # @const @must_use fn pack4xu8(e: vec4<i32>) -> u32
    const: true,
    must_use: true,
    [].(vec4[u32]) => u32,
}

# 17.9.5
function :pack4xI8Clamp, {
    # @const @must_use fn pack4xI8Clamp(e: vec4<i32>) -> u32
    const: true,
    must_use: true,
    [].(vec4[i32]) => u32,
}

# 17.9.6
function :pack4xU8Clamp, {
    # @const @must_use fn pack4xU8Clamp(e: vec4<i32>) -> u32
    const: true,
    must_use: true,
    [].(vec4[u32]) => u32,
}

# 17.9.7
function :pack2x16snorm, {
    # @const @must_use fn pack2x16snorm(e: vec2<f32>) -> u32
    const: true,
    must_use: true,
    [].(vec2[f32]) => u32,
}

# 17.9.8
function :pack2x16unorm, {
    # @const @must_use fn pack2x16unorm(e: vec2<f32>) -> u32
    const: true,
    must_use: true,
    [].(vec2[f32]) => u32,
}

# 17.9.9
function :pack2x16float, {
    # @const @must_use fn pack2x16float(e: vec2<f32>) -> u32
    const: true,
    must_use: true,
    [].(vec2[f32]) => u32,
}

# 17.10. Data Unpacking Built-in Functions (https://www.w3.org/TR/WGSL/#unpack-builtin-functions)

# 17.10.1
function :unpack4x8snorm, {
    # @const @must_use fn unpack4x8snorm(e: u32) -> vec4<f32>
    const: true,
    must_use: true,
    [].(u32) => vec4[f32],
}

# 17.10.2
function :unpack4x8unorm, {
    # @const @must_use fn unpack4x8unorm(e: u32) -> vec4<f32>
    const: true,
    must_use: true,
    [].(u32) => vec4[f32],
}

# 17.10.3
function :unpack4xI8, {
    # @const @must_use fn unpack4xI8(e: u32) -> vec4<i32>
    const: true,
    must_use: true,
    [].(u32) => vec4[i32],
}

# 17.10.4
function :unpack4xU8, {
    # @const @must_use fn unpack4xU8(e: u32) -> vec4<u32>
    const: true,
    must_use: true,
    [].(u32) => vec4[u32],
}

# 17.10.5
function :unpack2x16snorm, {
    # @const @must_use fn unpack2x16snorm(e: u32) -> vec2<f32>
    const: true,
    must_use: true,
    [].(u32) => vec2[f32],
}

# 17.10.6
function :unpack2x16unorm, {
    # @const @must_use fn unpack2x16unorm(e: u32) -> vec2<f32>
    const: true,
    must_use: true,
    [].(u32) => vec2[f32],
}

# 17.10.7
function :unpack2x16float, {
    # @const @must_use fn unpack2x16float(e: u32) -> vec2<f32>
    const: true,
    must_use: true,
    [].(u32) => vec2[f32],
}

# 17.11. Synchronization Built-in Functions (https://www.w3.org/TR/WGSL/#sync-builtin-functions)

# 17.11.1.
function :storageBarrier, {
    stage: :compute,

    # fn storageBarrier()
    [].() => void,
}

# 17.11.2.
function :textureBarrier, {
    stage: :compute,

    # fn textureBarrier()
    [].() => void,
}

# 17.11.3.
function :workgroupBarrier, {
    stage: :compute,

    # fn workgroupBarrier()
    [].() => void,
}

# 17.11.4.
function :workgroupUniformLoad, {
    must_use: true,
    stage: :compute,

    # @must_use fn workgroupUniformLoad(p : ptr<workgroup, atomic<T>, read_write>) -> T
    [T].(ptr[workgroup, atomic[T]]) => T,

    # @must_use fn workgroupUniformLoad(p : ptr<workgroup, T>) -> T
    [T].(ptr[workgroup, T]) => T,
}

# 17.12. Subgroup Built-in Functions (https://www.w3.org/TR/WGSL/#subgroup-builtin-functions)
# All subgroup built-in functions may only be used in a fragment or compute shader stage.

# Reduction and prefix-scan operations over a concrete numeric scalar or numeric vector.
[
    # 17.12.1 subgroupAdd / 17.12.1.1 subgroupExclusiveAdd / 17.12.1.2 subgroupInclusiveAdd
    :subgroupAdd,
    :subgroupExclusiveAdd,
    :subgroupInclusiveAdd,
    # 17.12.9 subgroupMul / 17.12.9.1 subgroupExclusiveMul / 17.12.9.2 subgroupInclusiveMul
    :subgroupMul,
    :subgroupExclusiveMul,
    :subgroupInclusiveMul,
    # 17.12.7 subgroupMax / 17.12.8 subgroupMin
    :subgroupMax,
    :subgroupMin,
    # 17.12.4 subgroupBroadcastFirst
    :subgroupBroadcastFirst,
].each do |op|
    function op, {
        must_use: true,
        stage: [:fragment, :compute],

        [T < ConcreteNumber].(T) => T,
        [T < ConcreteNumber, N].(vec[N][T]) => vec[N][T],
    }
end

# Bitwise reduction operations over an integer scalar or vector.
[
    # 17.12.2 subgroupAnd
    :subgroupAnd,
    # 17.12.10 subgroupOr
    :subgroupOr,
    # 17.12.14 subgroupXor
    :subgroupXor,
].each do |op|
    function op, {
        must_use: true,
        stage: [:fragment, :compute],

        [T < ConcreteInteger].(T) => T,
        [T < ConcreteInteger, N].(vec[N][T]) => vec[N][T],
    }
end

# Boolean reductions.
[
    # 17.12.3 subgroupAll
    :subgroupAll,
    # 17.12.3 subgroupAny
    :subgroupAny,
].each do |op|
    function op, {
        must_use: true,
        stage: [:fragment, :compute],

        [].(bool) => bool,
    }
end

# 17.12.5 subgroupBallot
function :subgroupBallot, {
    must_use: true,
    stage: [:fragment, :compute],

    [].(bool) => vec[4][u32],
}

# 17.12.6 subgroupElect
function :subgroupElect, {
    must_use: true,
    stage: [:fragment, :compute],

    [].() => bool,
}

# 17.12.6 subgroupBroadcast: id must be a const-expression in [0, 128).
function :subgroupBroadcast, {
    must_use: true,
    stage: [:fragment, :compute],
    validate: "validateSubgroupBroadcast",

    [T < ConcreteNumber, U < ConcreteInteger].(T, U) => T,
    [T < ConcreteNumber, N, U < ConcreteInteger].(vec[N][T], U) => vec[N][T],
}

# 17.12.12 subgroupShuffle: a const-expression id outside [0, 128) is a shader-creation error.
function :subgroupShuffle, {
    must_use: true,
    stage: [:fragment, :compute],
    validate: "validateSubgroupShuffle",

    [T < ConcreteNumber, U < ConcreteInteger].(T, U) => T,
    [T < ConcreteNumber, N, U < ConcreteInteger].(vec[N][T], U) => vec[N][T],
}

# Relative-shuffle operations with a u32 delta/mask.
# A const-expression delta/mask outside [0, 128) is a shader-creation error.
[
    # 17.12.12.1 subgroupShuffleDown
    :subgroupShuffleDown,
    # 17.12.12.2 subgroupShuffleUp
    :subgroupShuffleUp,
    # 17.12.12.3 subgroupShuffleXor
    :subgroupShuffleXor,
].each do |op|
    function op, {
        must_use: true,
        stage: [:fragment, :compute],
        validate: "validateSubgroupShuffle",

        [T < ConcreteNumber].(T, u32) => T,
        [T < ConcreteNumber, N].(vec[N][T], u32) => vec[N][T],
    }
end

# 17.13. Quad Built-in Functions (https://www.w3.org/TR/WGSL/#quad-builtin-functions)

# 17.13.1 quadBroadcast: id must be a const-expression in [0, 4).
function :quadBroadcast, {
    must_use: true,
    stage: [:fragment, :compute],
    validate: "validateQuadBroadcast",

    [T < ConcreteNumber, U < ConcreteInteger].(T, U) => T,
    [T < ConcreteNumber, N, U < ConcreteInteger].(vec[N][T], U) => vec[N][T],
}

# Quad swap operations exchanging values within a quad.
[
    # 17.13.2 quadSwapDiagonal
    :quadSwapDiagonal,
    # 17.13.3 quadSwapX
    :quadSwapX,
    # 17.13.4 quadSwapY
    :quadSwapY,
].each do |op|
    function op, {
        must_use: true,
        stage: [:fragment, :compute],

        [T < ConcreteNumber].(T) => T,
        [T < ConcreteNumber, N].(vec[N][T]) => vec[N][T],
    }
end
