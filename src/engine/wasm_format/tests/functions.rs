mod support;

use bun_engine_wasm_format::opcode::*;
use bun_engine_wasm_format::*;
use support::{
    ANYREF, EMPTY, EXNREF, EXTERNREF, F32, FUNCREF, I32, I64, NONE, NULLABLE, REF, STRUCTREF, V128,
    message, unsigned, valid, with_body,
};

const GC: u8 = GC_PREFIX;
const MISC: u8 = MISC_PREFIX;
const VECTOR: u8 = VECTOR_PREFIX;
const ATOMIC: u8 = ATOMIC_PREFIX;

/// i32, i64, f32, v128, (ref 4), (ref null 5), (ref null 6), externref, funcref, exnref
const LOCALS: &[u8] = &[
    10, 1, I32, 1, I64, 1, F32, 1, V128, 1, REF, 4, 1, NULLABLE, 5, 1, NULLABLE, 6, 1, EXTERNREF,
    1, FUNCREF, 1, EXNREF,
];
const GET: u8 = LOCAL_GET;

fn function(ty: u8, code: &[u8]) -> Vec<u8> {
    with_body(ty, &[LOCALS, code, &[END]].concat())
}

fn facts(ty: u8, body: &[u8]) -> FunctionFacts {
    *valid(&with_body(ty, body)).facts(CodeIndex(0))
}

#[test]
fn valid_code() {
    let cases: &[(u8, &[u8])] = &[
        (2, &[GET, 0, GET, 1, CALL, 1, I32_TRUNC_F32_S]),
        (8, &[CALL, 2]),
        (8, &[RETURN_CALL, 2]),
        (8, &[BLOCK, 8, CALL, 2, GET, 0, BR_IF, 0, END]),
        (0, &[GET, 0, LOOP, 1, GET, 0, BR_IF, 0, DROP, END]),
        (0, &[GET, 0, GET, 0, IF, 1, DROP, ELSE, DROP, END]),
        (0, &[BLOCK, 0x89, 0x80, 0x80, 0x80, 0, END]),
        (
            0,
            &[
                GET, 1, I64_LOAD, 0x43, 1, 0xff, 0xff, 0xff, 0xff, 0xff, 1, DROP,
            ],
        ),
        (0, &[GET, 1, GET, 0, GET, 0, MISC, 10, 1, 0]),
        (0, &[GET, 1, GET, 1, GET, 1, MISC, 10, 1, 1]),
        (0, &[GET, 0, GET, 8, TABLE_SET, 0, REF_FUNC, 1, DROP]),
        (0, &[GET, 0, GET, 1, REF_FUNC, 1, CALL_REF, 3, DROP]),
        (0, &[GET, 0, CALL_INDIRECT, 9, 0]),
        (
            0,
            &[GET, 5, REF_AS_NON_NULL, LOCAL_TEE, 4, DROP, GET, 4, DROP],
        ),
        (0, &[GET, 5, GC, 3, 4, 1, DROP, GET, 5, GC, 2, 5, 3, DROP]),
        (
            0,
            &[
                GET, 0, GET, 0, REF_NULL, NONE, GC, 0, 4, GC, 22, 5, LOCAL_SET, 5,
            ],
        ),
        (
            0,
            &[
                BLOCK, REF, 5, GC, 1, 4, GC, 24, 0, 0, 4, 5, DROP, RETURN, END, DROP,
            ],
        ),
        (
            0,
            &[
                BLOCK, REF, 4, GC, 1, 4, GC, 25, 3, 0, 4, 5, LOCAL_SET, 5, RETURN, END, DROP,
            ],
        ),
        (
            0,
            &[BLOCK, ANYREF, GET, 5, BR_ON_NON_NULL, 0, RETURN, END, DROP],
        ),
        (0, &[GET, 6, GET, 0, GET, 6, GET, 0, GET, 0, GC, 17, 6, 6]),
        (0, &[GET, 0, GET, 0, GC, 10, 7, 0, GC, 15, DROP]),
        (0, &[GET, 7, GC, 26, GC, 27, LOCAL_SET, 7]),
        (0, &[GET, 5, GET, 6, GET, 0, SELECT_TYPED, 1, ANYREF, DROP]),
        (
            2,
            &[
                TRY, I32, GET, 0, CATCH, 1, CATCH, 0, GET, 0, CATCH_ALL, RETHROW, 0, END,
            ],
        ),
        (
            0,
            &[
                BLOCK, EMPTY, TRY, EMPTY, DELEGATE, 0, END, TRY, EMPTY, DELEGATE, 0,
            ],
        ),
        (
            2,
            &[TRY_TABLE, EMPTY, 1, 0, 1, 0, GET, 0, THROW, 1, END, GET, 0],
        ),
        (
            0,
            &[
                BLOCK, EXNREF, TRY_TABLE, EMPTY, 2, 1, 0, 0, 3, 0, END, RETURN, END, THROW_REF,
            ],
        ),
        (8, &[GET, 0, GET, 1, GET, 1, MISC, 21, DROP]),
        (0, &[GET, 0, GET, 3, VECTOR, 0x5b, 3, 0, 1]),
        (0, &[GET, 3, GET, 3, GET, 3, VECTOR, 0x93, 0x02, DROP]),
        (
            0,
            &[
                GET, 0, GET, 1, GET, 1, ATOMIC, 0x4e, 2, 0, DROP, ATOMIC, 3, 0,
            ],
        ),
    ];
    for &(ty, code) in cases {
        valid(&function(ty, code));
    }
}

#[test]
fn unreachable_code_takes_values_of_any_type() {
    let cases: &[(u8, &[u8])] = &[
        (2, &[I32_ADD]),
        (8, &[]),
        (8, &[GET, 1]),
        (2, &[SELECT]),
        (2, &[GET, 0, GET, 0, SELECT]),
        (2, &[REF_IS_NULL]),
        (0, &[REF_AS_NON_NULL, LOCAL_SET, 4]),
        (0, &[REF_AS_NON_NULL, CALL_REF, 0]),
        (0, &[BR_ON_NULL, 0, THROW_REF]),
        (0, &[GC, 27, LOCAL_SET, 7]),
        (0, &[BLOCK, 1, DROP, END]),
        (0, &[GET, 1, CALL, 1, DROP]),
        (0, &[GC, 0, 5, DROP, GC, 8, 6, 0x90, 0x4e, DROP]),
        (
            0,
            &[
                BLOCK,
                F32,
                BLOCK,
                I32,
                UNREACHABLE,
                BR_TABLE,
                1,
                0,
                1,
                END,
                UNREACHABLE,
                END,
                DROP,
            ],
        ),
        (
            0,
            &[
                BLOCK, EMPTY, BLOCK, EMPTY, GET, 5, BR_ON_NULL, 2, DROP, END, END,
            ],
        ),
        (0, &[TRY, EMPTY, DELEGATE, 0]),
        (
            0,
            &[TRY, EMPTY, CATCH_ALL, BLOCK, EMPTY, RETHROW, 1, END, END],
        ),
    ];
    for &(ty, code) in cases {
        valid(&function(ty, &[&[UNREACHABLE], code].concat()));
    }
}

/// The offset is from the first instruction.
#[test]
fn malformed_code() {
    let cases: &[(&[u8], usize, &str)] = &[
        (&[0x27], 1, "invalid opcode 39"),
        (&[0xff], 1, "invalid opcode 255"),
        (&[BLOCK, EMPTY], 3, "can't decode opcode"),
        (
            &[END],
            1,
            "function body size doesn't match the expected size",
        ),
        (&[BLOCK, 4], 2, "can't get block's signature"),
        (&[LOOP, 10], 2, "can't get loop's signature"),
        (&[IF, 0x7a], 2, "can't get if's signature"),
        (&[TRY, REF, 10], 3, "can't get try's signature"),
        (
            &[BLOCK, 0x80, 0x80, 0x80, 0x80, 0x80, 0],
            7,
            "can't get block's signature",
        ),
        (
            &[UNREACHABLE, IF, 4],
            3,
            "can't get inline type for If in unreachable context",
        ),
        (
            &[UNREACHABLE, TRY_TABLE, 4],
            3,
            "can't get try_table's signature in unreachable context",
        ),
        (
            &[ELSE],
            1,
            "can't use else block at the top-level of a function",
        ),
        (
            &[CATCH, 0],
            1,
            "can't use catch block at the top-level of a function",
        ),
        (
            &[DELEGATE, 0],
            1,
            "can't use delegate at the top-level of a function",
        ),
        (
            &[TRY, EMPTY, DELEGATE, 1],
            4,
            "delegate target 1 exceeds control stack size 1",
        ),
        (
            &[BR, 1],
            2,
            "br / br_if's target 1 exceeds control stack size 1",
        ),
        (
            &[BR_TABLE, 2, 1, 0, 0],
            4,
            "br_table's 0th target 1 exceeds control stack size 1",
        ),
        (
            &[BR_TABLE, 0, 1],
            3,
            "br_table's default target 1 exceeds control stack size 1",
        ),
        (
            &[UNREACHABLE, BR_TABLE, 0, 1],
            4,
            "br_table's default target 1 exceeds control stack size 1",
        ),
        (
            &[BR_TABLE, 0xff, 0xff, 0xff, 0xff, 0x0f],
            6,
            "br_table's number of targets is too big 4294967295",
        ),
        (
            &[TRY_TABLE, EMPTY, 1, 4],
            4,
            "invalid opcode of try_table catch at index 0,  opcode 4 is invalid",
        ),
        (
            &[TRY_TABLE, EMPTY, 1, 0, 2],
            5,
            "can't read tag of try_table catch at index 0",
        ),
        (
            &[TRY_TABLE, EMPTY, 1, 2, 1],
            5,
            "try_table's catch target 1 exceeds control stack size 1",
        ),
        (
            &[CALL, 3],
            2,
            "function index 3 exceeds function index space 3",
        ),
        (
            &[GET, 0, CALL, 1],
            4,
            "call function index 1 has 2 arguments, but the expression stack currently holds 1 values",
        ),
        (
            &[CALL_INDIRECT, 0, 2],
            3,
            "call_indirect's table index 2 invalid, limit is 2",
        ),
        (
            &[CALL_INDIRECT, 10, 0],
            3,
            "call_indirect's signature index 10 exceeds known signatures 10",
        ),
        (
            &[CALL_INDIRECT, 0, 1],
            3,
            "call_indirect is only valid when a table has type funcref",
        ),
        (
            &[CALL_INDIRECT, 0, 0],
            3,
            "call_indirect expects 1 arguments, but the expression stack currently holds 0 values",
        ),
        (
            &[CALL_REF, 0],
            2,
            "can't call_ref on empty expression stack",
        ),
        (
            &[RETURN_CALL, 2],
            2,
            "tail call function index 2 with return count 2, but the caller's signature has 0 return values",
        ),
        (
            &[GET, 8, GET, 8, GET, 0, SELECT],
            7,
            "can't use ref-types with unannotated select",
        ),
        (
            &[UNREACHABLE, GET, 8, GET, 0, SELECT],
            6,
            "can't use ref-types with unannotated select",
        ),
        (&[SELECT_TYPED, 2], 2, "select invalid result arity for"),
        (
            &[LOCAL_TEE, 0],
            2,
            "can't tee_local on empty expression stack",
        ),
        (
            &[GET, 0, BLOCK, EMPTY, I32_EQZ],
            5,
            "can't pop empty stack in unary",
        ),
        (
            &[UNREACHABLE, BLOCK, EMPTY, I32_EQZ],
            4,
            "can't pop empty stack in unary",
        ),
        (
            &[I32_LOAD, 3, 0],
            2,
            "byte alignment 8 exceeds load's natural alignment 4",
        ),
        (
            &[I64_STORE8, 0x41, 1, 0],
            3,
            "byte alignment 2 exceeds store's natural alignment 1",
        ),
        (
            &[UNREACHABLE, I32_LOAD, 3, 0],
            3,
            "byte alignment 8 exceeds I32Load's natural alignment 4",
        ),
        (
            &[I32_LOAD, 0x80, 1],
            3,
            "byte alignment immediate 128 is too large",
        ),
        (
            &[ATOMIC, 0x10, 1, 0],
            3,
            "byte alignment 2 does not match against atomic op's natural alignment 4",
        ),
        (&[ATOMIC, 3, 1], 3, "flags should be 0x0 but got 1"),
        (&[ATOMIC, 0x4f], 2, "invalid extended atomic op 79"),
        (&[MISC, 18], 2, "invalid 0xfc extended op 18"),
        (&[UNREACHABLE, MISC, 23], 3, "invalid extended 0xfc op 23"),
        (&[GC, 31], 2, "invalid extended GC op 31"),
        (&[VECTOR, 0x9a, 1], 3, "invalid extended simd op 154"),
        (&[VECTOR, 0x94, 2], 3, "invalid extended simd op 276"),
        (
            &[VECTOR, 0x1d, 2],
            3,
            "Lane index immediate is too large, saw 2, expected an ImmLaneIdx2",
        ),
        (&[VECTOR, 0x0b, 5, 0], 2, "can't pop empty stack in val"),
        (
            &[GET, 3, VECTOR, 0x54, 0, 0, 0],
            6,
            "can't pop empty stack in simd memory op pointer",
        ),
        (
            &[GET, 3, VECTOR, 0x54, 0, 0, 16],
            6,
            "can't pop empty stack in simd memory op pointer",
        ),
        (
            &[GC, 5, 10, 0],
            2,
            "can't pop empty stack in struct.set value",
        ),
        (
            &[I32_CONST, 0x80, 0x80, 0x80, 0x80, 0x08],
            6,
            "can't parse 32-bit constant",
        ),
        (
            &[F64_CONST, 0],
            1,
            "can't parse 64-bit floating-point constant",
        ),
        (
            &[REF_NULL, 0xf0, 0x7f],
            3,
            "ref.null heaptype must be funcref, externref or type_idx",
        ),
        (&[REF_FUNC, 3], 2, "can't get index for ref.func"),
        (
            &[GC, 2, 4, 3],
            4,
            "struct.get field immediate 3 is out of bounds",
        ),
        (
            &[GET, 5, GC, 2, 4, 1],
            6,
            "struct.get applied to packed array of I8 -- use struct.get_s or struct.get_u",
        ),
        (
            &[GET, 5, GC, 4, 4, 2],
            6,
            "struct.get_u applied to wrong type of struct -- expected: i8 or i16, found RefNull",
        ),
        (
            &[GET, 5, GET, 5, GC, 5, 4, 2],
            8,
            "the field 2 can't be set because it is immutable",
        ),
        (
            &[GET, 5, GET, 1, GC, 5, 4, 1],
            8,
            "type mismatch in struct.set",
        ),
        (
            &[GC, 0, 4],
            3,
            "struct.new 4 requires 3 values, but the expression stack currently holds 0 values",
        ),
        (
            &[GC, 1, 5],
            3,
            "struct.new_default 5 requires all fields to be defaultable, but field 3 has type Ref",
        ),
        (
            &[GC, 11, 6],
            3,
            "array.get applied to packed array of I16 -- use array.get_s or array.get_u",
        ),
    ];
    for &(code, offset, reason) in cases {
        let offset = LOCALS.len() + offset;
        let expected = format!("parse at byte {offset}: {reason}, in function at index 0");
        assert_eq!(message(&function(0, code)), expected);
    }
}

#[test]
fn invalid_code() {
    let cases: &[(&[u8], &str)] = &[
        (
            &[GET, 0],
            " block with type: () -> [] returns: 0 but stack has: 1 values",
        ),
        (
            &[UNREACHABLE, GET, 0],
            " block with type: () -> [] returns: 0 but stack has: 1 values",
        ),
        (
            &[BLOCK, 8, GET, 0, GET, 0, END],
            "control flow returns with unexpected type. I32 is not a I64",
        ),
        (
            &[GET, 0, IF, I32, GET, 0, END],
            " block with type: () -> [I32] returns: 1 but stack has: 0 values",
        ),
        (
            &[GET, 0, IF, I32, UNREACHABLE, END],
            " block with type: () -> [I32] returns: 1 but stack has: 0 values",
        ),
        (
            &[GET, 0, GET, 0, IF, 1, DROP, END],
            " block with type: (I32) -> [] returns: 0 but stack has: 1 values",
        ),
        (
            &[BLOCK, 1],
            "Too few values on stack for block. Block expects 1, but only 0 were present. Block has signature: (I32) -> []",
        ),
        (
            &[TRY_TABLE, 1, 1, 4],
            "Too few values on stack for block. Block expects 1, but only 0 were present. Block has signature: (I32) -> []",
        ),
        (
            &[GET, 0, GET, 0, LOOP, 3],
            "Block expects the argument at index 1 to be I64 but argument has type I32",
        ),
        (&[GET, 1, IF, EMPTY], "if condition must be i32, got I64"),
        (
            &[BLOCK, EMPTY, ELSE],
            "else block isn't associated to an if",
        ),
        (
            &[GET, 0, IF, EMPTY, ELSE, ELSE],
            "else block isn't associated to an if",
        ),
        (
            &[UNREACHABLE, BLOCK, EMPTY, ELSE],
            "else block isn't associated to an if",
        ),
        (
            &[BLOCK, I32, BR, 0],
            "branch to block on expression stack of size 0, but block, () -> [I32] expects 1 values",
        ),
        (
            &[GET, 0, LOOP, 1, GET, 1, BR, 0],
            "branch's stack type is not a subtype of block's type branch target type. Stack value has type I64 but branch target expects a value of I32 at index 0",
        ),
        (
            &[GET, 2, BR_IF, 0],
            "conditional branch with non-i32 condition F32",
        ),
        (
            &[BLOCK, ANYREF, GET, 5, GET, 0, BR_IF, 0, LOCAL_SET, 5],
            "set_local to type (ref null any) expected (ref null <struct:5>)",
        ),
        (
            &[BLOCK, I32, GET, 0, BR_TABLE, 1, 0, 1],
            "br_table target type size mismatch. Default has size: 0but target: 0 has size: 1",
        ),
        (
            &[BLOCK, I32, BLOCK, F32, GET, 0, GET, 0, BR_TABLE, 2, 1, 0, 1],
            "branch's stack type is not a subtype of block's type branch target type. Stack value has type I32 but branch target expects a value of F32 at index 0",
        ),
        (
            &[GET, 0, BR_ON_NULL, 0],
            "br_on_null ref to type I32 expected a reference type",
        ),
        (
            &[GET, 5, BR_ON_NON_NULL, 0],
            "br_on_non_null target expects no values",
        ),
        (
            &[GET, 5, GC, 24, 1, 0, 4, 5],
            "br_on_cast target expects no values",
        ),
        (
            &[GET, 5, GC, 24, 0, 0, 4, 5],
            "br_on_cast to type (ref null <struct:5>) expected a reference type with source heaptype",
        ),
        (
            &[GET, 5, GC, 25, 1, 0, 5, 4],
            "target heaptype was not a subtype of source heaptype for br_on_cast_fail",
        ),
        (
            &[GC, 24, 4],
            "reserved bits set in flags byte for br_on_cast",
        ),
        (
            &[GET, 0, GET, 0, CALL, 1],
            "argument type mismatch in call, got I32, expected I64",
        ),
        (
            &[GET, 1, CALL_INDIRECT, 0, 0],
            "call_indirect index to type I64 expected I32",
        ),
        (
            &[CALL_INDIRECT, 4, 0],
            "invalid type index (not a function signature) for call_indirect, got 4",
        ),
        (
            &[GET, 8, CALL_REF, 9],
            "invalid type for call_ref value, expected (ref null <func:0>) got (ref null func)",
        ),
        (
            &[UNREACHABLE, CALL_REF, 6],
            "invalid type index (not a function signature) for call_ref, got 6",
        ),
        (
            &[BLOCK, EMPTY, CATCH_ALL],
            "catch block isn't associated to a try",
        ),
        (
            &[TRY, EMPTY, CATCH_ALL, CATCH, 0],
            "catch block isn't associated to a try",
        ),
        (
            &[TRY, EMPTY, CATCH, 0, DELEGATE, 0],
            "delegate isn't associated to a try",
        ),
        (
            &[TRY, EMPTY, RETHROW, 0],
            "rethrow doesn't refer to a catch block",
        ),
        (&[THROW, 2], "exception index 2 is invalid, limit is 2"),
        (
            &[THROW, 1],
            "Too few arguments on stack for the exception being thrown. The exception expects 1, but only 0 were present. Exception has signature: (I32) -> []",
        ),
        (
            &[GET, 1, THROW, 1],
            "The exception being thrown expects the argument at index 0 to be I32 but argument has type I64",
        ),
        (
            &[GET, 7, THROW_REF],
            "throw_ref expected an exception reference",
        ),
        (&[TRY_TABLE, EMPTY, 1, 3, 0], ""),
        (
            &[BLOCK, I64, TRY_TABLE, EMPTY, 1, 0, 1, 0],
            "try_table target type mismatch",
        ),
        (
            &[GET, 10],
            "attempt to use unknown local 10, the number of locals is 10",
        ),
        (
            &[GET, 4],
            "non-defaultable function local 4 is accessed before initialization",
        ),
        (
            &[BLOCK, EMPTY, GC, 1, 4, LOCAL_SET, 4, END, GET, 4],
            "non-defaultable function local 4 is accessed before initialization",
        ),
        (
            &[GET, 0, IF, EMPTY, GC, 1, 4, LOCAL_SET, 4, ELSE, GET, 4],
            "non-defaultable function local 4 is accessed before initialization",
        ),
        (
            &[GET, 5, LOCAL_SET, 4],
            "set_local to type (ref null <struct:5>) expected (ref <struct:4>)",
        ),
        (&[GLOBAL_GET, 3], "3 of unknown global, limit is 3"),
        (&[UNREACHABLE, GLOBAL_SET, 0], "set_global 0 is immutable"),
        (
            &[GET, 0, GLOBAL_SET, 1],
            "set_global 1 with type I64 with a variable of type I32",
        ),
        (
            &[GET, 0, GET, 1, GET, 0, SELECT],
            "select result types must match, got I32 and I64",
        ),
        (
            &[GET, 8, GET, 7, GET, 0, SELECT_TYPED, 1, FUNCREF],
            "select result types must match, got (ref null extern) and (ref null func)",
        ),
        (
            &[GET, 1, GET, 1, I32_ADD],
            "I32Add left value type mismatch",
        ),
        (
            &[UNREACHABLE, GET, 0, F64_GE],
            "F64Ge right value type mismatch",
        ),
        (&[GET, 0, I32_WRAP_I64], "I32WrapI64 value type mismatch"),
        (
            &[GET, 0, MISC, 7],
            "trunc-saturated value type mismatch. Expected: F64 but expression stack has I32",
        ),
        (
            &[GET, 1, GET, 0, GET, 1, GET, 1, MISC, 20],
            "i64.add128/sub128 lhs_hi to type I32 expected I64",
        ),
        (
            &[GET, 0, F32_LOAD, 0x40, 1, 0],
            "F32Load pointer type mismatch",
        ),
        (
            &[GET, 0, GET, 0, I64_STORE32, 0, 0],
            "I64Store32 value type mismatch",
        ),
        (&[I32_LOAD, 0x40, 2], "memory index 2 is out of range"),
        (
            &[I32_LOAD, 0, 0x80, 0x80, 0x80, 0x80, 0x10],
            "memory offset 4294967296 is out of range for an i32 memory",
        ),
        (
            &[GET, 0, MEMORY_GROW, 1],
            "grow_memory with non-i64 delta argument has type: I32",
        ),
        (
            &[GET, 1, GET, 0, GET, 1, MISC, 10, 1, 0],
            "memory.copy size to type I64 expected I32",
        ),
        (&[MISC, 9, 1], "data segment index 1 is invalid, limit is 1"),
        (&[MISC, 13, 1], "element index 1 is invalid, limit is 1"),
        (
            &[MISC, 12, 0, 1],
            "table.init requires table's type \"(ref null extern)\" and element's type \"(ref func)\" are the same",
        ),
        (
            &[MISC, 14, 0, 1],
            "type mismatch at table.copy. got (ref null extern) and (ref null func)",
        ),
        (
            &[GET, 7, GET, 0, MISC, 15, 0],
            "table.grow expects fill value of type (ref null func) got (ref null extern)",
        ),
        (
            &[GET, 1, GET, 8, GET, 0, MISC, 17, 0],
            "table.fill expects an I32 offset value, got I64",
        ),
        (&[TABLE_GET, 2], "table index 2 is invalid, limit is 2"),
        (
            &[GET, 0, GET, 0, ATOMIC, 0x18, 3, 0],
            "ExtAtomic value type mismatch",
        ),
        (
            &[GET, 0, GET, 0, GET, 0, ATOMIC, 1, 2, 0],
            "1 timeout type mismatch",
        ),
        (
            &[GET, 0, GET, 0, GET, 1, ATOMIC, 0x49, 3, 0],
            "73 expected type mismatch",
        ),
        (&[REF_FUNC, 2], "ref.func index 2 isn't declared"),
        (
            &[GET, 8, GET, 5, REF_EQ],
            "ref.eq ref1 to type RefNull expected Eqref",
        ),
        (
            &[UNREACHABLE, REF_AS_NON_NULL, F32_ABS],
            "F32Abs value type mismatch",
        ),
        (
            &[GET, 8, GC, 20, STRUCTREF],
            "ref.cast to type (ref null func) expected a subtype of anyref",
        ),
        (
            &[GET, 8, GC, 21, 4],
            "ref.test to type (ref null func) expected a subtype of anyref",
        ),
        (
            &[GET, 5, GC, 22, 0],
            "ref.cast to type (ref null <struct:5>) expected a funcref",
        ),
        (
            &[GET, 7, GC, 26, LOCAL_SET, 7],
            "set_local to type (ref null any) expected (ref null extern)",
        ),
        (
            &[GET, 5, GC, 29],
            "i31.get_s ref to type (ref null <struct:5>) expected I31ref",
        ),
        (
            &[GC, 1, 4, GC, 2, 5, 0],
            "struct.get structref to type (ref <struct:4>) expected (ref null <struct:5>)",
        ),
        (&[GC, 0, 6], "struct.new: invalid type index 6"),
        (
            &[UNREACHABLE, GC, 6, 4],
            "array.new index 4 does not reference an array definition",
        ),
        (
            &[GET, 0, GET, 1, GC, 8, 6, 2],
            "argument type mismatch in array.new_fixed, got I64, expected a subtype of I32",
        ),
        (
            &[GC, 8, 6, 0x91, 0x4e],
            "array_new_fixed can take at most 10000 operands. Got 10001",
        ),
        (
            &[GC, 9, 7, 0],
            "array.new_data expected numeric, packed, or vector type; found (ref null func)",
        ),
        (
            &[GC, 10, 6, 0],
            "type mismatch in array.new_elem: expected `funcref` or `externref`",
        ),
        (
            &[GC, 14, 7],
            "array.set index 7 does not reference a mutable array definition",
        ),
        (
            &[GC, 17, 6, 7],
            "array.copy src index 7 does not reference a subtype of dst index 6",
        ),
        (
            &[GC, 19, 6, 0],
            "type mismatch in array.init_elem: segment elements have type (ref func) but array.init_elem operation expects elements of type I32",
        ),
        (&[GET, 1, VECTOR, 0x11], "Wrong type to SIMD splat"),
        (
            &[GET, 0, GET, 3, GET, 3, VECTOR, 0x52],
            "type mismatch for argument 2",
        ),
        (
            &[GET, 0, GET, 3, GET, 3, VECTOR, 0x85, 2],
            "type mismatch for argument 0",
        ),
        (
            &[GET, 3, GET, 0, VECTOR, 0x9c, 1],
            "extmul rhs vector must be v128",
        ),
        (
            &[GET, 0, VECTOR, 0x58, 1, 0, 0],
            "store_lane input must be a vector",
        ),
        (
            &[VECTOR, 0x5c, 3, 0],
            "alignment: 3 can't be larger than max alignment for simd operation: 2",
        ),
    ];
    for &(code, reason) in cases {
        let expected = format!("validate: {reason}, in function at index 0");
        assert_eq!(message(&function(0, code)), expected);
    }
}

#[test]
fn locals() {
    let at_limit = [&[2, 1, I64][..], &unsigned(49_998), &[F32]].concat();
    let get = |local| {
        [
            &at_limit[..],
            &[GET],
            &unsigned(local),
            &[F32_ABS, DROP, END],
        ]
        .concat()
    };
    assert_eq!(facts(1, &get(49_999)).local_count, 50_000);
    assert_eq!(facts(1, &get(2)).code_offset, 7);
    let cases: [(&[u8], &str); 6] = [
        (&get(1), "validate: F32Abs value type mismatch"),
        (
            &get(50_000),
            "validate: attempt to use unknown local 50000, the number of locals is 50000",
        ),
        (&[], "parse at byte 0: can't get local groups count"),
        (
            &[1],
            "parse at byte 1: can't get Function's number of locals in group 0",
        ),
        (
            &[1, 0, EMPTY],
            "parse at byte 3: can't get Function local's type in group 0",
        ),
        (
            &[1, 0xd0, 0x86, 3],
            "parse at byte 4: Function's number of locals is too big 50001 maximum 50000",
        ),
    ];
    for (body, expected) in cases {
        assert_eq!(
            message(&with_body(1, body)),
            format!("{expected}, in function at index 0")
        );
    }
}

#[test]
fn what_validation_finds_out() {
    let body = [
        0,
        LOOP,
        EMPTY,
        CALL,
        2,
        CALL,
        2,
        DROP,
        DROP,
        DROP,
        DROP,
        END,
        RETURN_CALL,
        0,
        LOOP,
        EMPTY,
        CALL,
        0,
        END,
        END,
    ];
    let found = facts(0, &body);
    assert_eq!(
        (found.max_stack_height, found.call_count, found.loop_count),
        (4, 4, 2)
    );
    assert_eq!(found.flags, FunctionFlags::HAS_TAIL_CALL);

    let nested = [
        TRY, EMPTY, CATCH, 0, TRY, EMPTY, CATCH_ALL, END, CATCH_ALL, END,
    ];
    let found = facts(0, &[&[0][..], &nested, &nested, &[END]].concat());
    assert_eq!(
        (found.max_catch_depth, found.flags),
        (2, FunctionFlags::HAS_TRY)
    );

    let with_vectors: [&[u8]; 4] = [
        &[1, 0, V128, END],
        &[0, GLOBAL_GET, 2, DROP, END],
        &[0, BLOCK, V128, UNREACHABLE, END, DROP, END],
        &[0, I32_CONST, 0, VECTOR, 0x0f, DROP, END],
    ];
    for body in with_vectors {
        assert_eq!(facts(0, body).flags, FunctionFlags::USES_SIMD);
    }
}

#[test]
fn one_kind_of_exception_handling() {
    let (old, new) = ([TRY, EMPTY, END], [TRY_TABLE, EMPTY, 0, END]);
    let both = function(0, &[&old[..], &new].concat());
    assert_eq!(
        message(&both),
        "Module uses both legacy exceptions and try_table"
    );
    valid(&function(0, &[&old[..], &[RETURN], &new].concat()));
    valid(&function(
        0,
        &[&new[..], &[RETURN, BLOCK, EMPTY], &old, &[END]].concat(),
    ));
}

#[test]
fn scratch_memory_keeps_nothing() {
    let module = valid(&function(0, &[]));
    let mut scratch = Scratch::default();
    let mut check = |code: &[u8]| {
        let body = [LOCALS, code, &[END]].concat();
        validate_function(&module, CodeIndex(0), &body, &mut scratch)
            .map(|facts| facts.max_stack_height)
    };
    assert!(
        check(&[
            GET,
            0,
            GET,
            0,
            BLOCK,
            EMPTY,
            GC,
            1,
            4,
            LOCAL_SET,
            4,
            UNREACHABLE,
            0xff
        ])
        .is_err()
    );
    assert!(check(&[GET, 4, DROP]).is_err());
    assert!(check(&[DROP]).is_err());
    assert_eq!(check(&[GET, 0, DROP]), Ok(1));
}
