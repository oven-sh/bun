#![allow(clippy::disallowed_methods)]

mod support;

use std::fmt::Debug;

use bun_engine_asm::{
    AtomicOp, Cond, FloatCond, FloatWidth, Rounding, Shift, Sign, Size, VectorBinary, VectorReduce,
    VectorShift, VectorTernary, VectorUnary, Width,
};
use bun_engine_wasm_format::opcode::*;
use bun_engine_wasm_format::*;
use support::{
    EMPTY, FUNC, I32, I64, V128, code, list, list_of, module, unsigned, valid, with_body,
};

#[derive(PartialEq, Debug)]
struct Pause;

/// Writes down what is visited.
#[derive(Default)]
struct Log<'a> {
    lines: Vec<String>,
    offsets: Vec<u32>,
    /// After these offsets control does not go on.
    dead_after: &'a [u32],
    pause_at: &'a [u32],
    inline_from: Option<&'a Module>,
}

impl Log<'_> {
    fn note(&mut self, name: &str, arguments: &[&dyn Debug]) -> Result<(), Pause> {
        let arguments = arguments.iter().map(|argument| format!(" {argument:?}"));
        self.lines
            .push(arguments.fold(name.into(), |line, argument| line + &argument));
        if self.pause_at.contains(self.offsets.last().unwrap()) {
            return Err(Pause);
        }
        Ok(())
    }

    fn text(&self) -> String {
        self.lines.join("; ")
    }
}

macro_rules! note {
    ($($name:ident($($argument:ident: $type:ty),*);)*) => {
        $(fn $name(&mut self, $($argument: $type),*) -> Result<(), Pause> {
            self.note(stringify!($name), &[$(&$argument),*])
        })*
    };
}

impl Visit for Log<'_> {
    type Error = Pause;

    fn unhandled(&mut self) -> Result<(), Pause> {
        self.note("other", &[])
    }

    fn at(&mut self, offset: u32) {
        self.offsets.push(offset);
    }

    fn flow(&self) -> Flow {
        match self.offsets.last() {
            Some(offset) if self.dead_after.contains(offset) => Flow::Dead,
            _ => Flow::Live,
        }
    }
}

impl VisitControl for Log<'_> {
    fn call(&mut self, func: FuncIndex, site: u32) -> Result<(), Pause> {
        self.note("call", &[&func.0, &site])?;
        match self.inline_from {
            Some(module) => module
                .body(module.code_index(func).unwrap())
                .driver()
                .run(self),
            None => Ok(()),
        }
    }

    fn br_table(&mut self, table: BrTable<'_>) -> Result<(), Pause> {
        self.note(
            "br_table",
            &[&table.labels().collect::<Vec<_>>(), &table.default_label()],
        )
    }

    fn try_table(&mut self, ty: BlockType, catches: Catches<'_>) -> Result<(), Pause> {
        let parts = |catch: Catch| (catch.tag.map(|tag| tag.0), catch.passes_exnref, catch.label);
        self.note("try_table", &[&ty, &catches.map(parts).collect::<Vec<_>>()])
    }

    note! {
        unreachable();
        nop();
        block(ty: BlockType);
        loop_(ty: BlockType, index: u32);
        if_(ty: BlockType);
        else_(flow: Flow);
        end(flow: Flow);
        br(label: u32);
        br_on_cast(label: u32, from: RefType, to: RefType);
        call_indirect(ty: TypeIndex, table: TableIndex, site: u32);
        try_(ty: BlockType);
        catch(tag: TagIndex, flow: Flow);
        catch_all(flow: Flow);
        delegate(label: u32, flow: Flow);
    }
}

impl VisitVariable for Log<'_> {}

impl VisitNumeric for Log<'_> {
    note! {
        i32_const(value: i32);
        i64_const(value: i64);
        f32_const(bits: u32);
        f64_const(bits: u64);
        int_eqz(width: Width);
        int_compare(width: Width, cond: Cond);
        int_unary(width: Width, op: IntUnaryOp);
        int_binary(width: Width, op: IntBinaryOp);
        int_div(width: Width, sign: Sign);
        int_rem(width: Width, sign: Sign);
        int_shift(width: Width, shift: Shift);
        int_sign_extend(width: Width, from: Size);
        float_compare(width: FloatWidth, cond: FloatCond);
        float_unary(width: FloatWidth, op: FloatUnaryOp);
        float_round(width: FloatWidth, rounding: Rounding);
        float_binary(width: FloatWidth, op: FloatBinaryOp);
        i32_wrap_i64();
        i64_extend_i32(sign: Sign);
        truncate_float(from: FloatWidth, sign: Sign, to: Width);
        truncate_float_saturating(from: FloatWidth, sign: Sign, to: Width);
        convert_int_to_float(sign: Sign, from: Width, to: FloatWidth);
        f32_demote_f64();
        f64_promote_f32();
        reinterpret_float_as_int(width: FloatWidth);
        reinterpret_int_as_float(width: FloatWidth);
        i64_add128();
        i64_sub128();
        i64_mul_wide(sign: Sign);
    }
}

impl VisitMemory for Log<'_> {
    fn load(&mut self, op: LoadOp, arg: MemArg) -> Result<(), Pause> {
        self.note(
            "load",
            &[
                &op.value_type(),
                &op.size(),
                &op.sign(),
                &arg.memory.0,
                &arg.offset,
            ],
        )
    }

    fn store(&mut self, op: StoreOp, arg: MemArg) -> Result<(), Pause> {
        self.note(
            "store",
            &[&op.value_type(), &op.size(), &arg.memory.0, &arg.offset],
        )
    }

    fn atomic_load(&mut self, width: Width, size: Size, _: MemArg) -> Result<(), Pause> {
        self.note("load", &[&width, &size])
    }

    fn atomic_store(&mut self, width: Width, size: Size, _: MemArg) -> Result<(), Pause> {
        self.note("store", &[&width, &size])
    }

    fn atomic_update(
        &mut self,
        op: AtomicOp,
        width: Width,
        size: Size,
        _: MemArg,
    ) -> Result<(), Pause> {
        self.note(&format!("{op:?}"), &[&width, &size])
    }

    fn atomic_compare_exchange(
        &mut self,
        width: Width,
        size: Size,
        _: MemArg,
    ) -> Result<(), Pause> {
        self.note("cmpxchg", &[&width, &size])
    }

    note! {
        memory_copy(dst: MemoryIndex, src: MemoryIndex);
        memory_init(memory: MemoryIndex, data: DataIndex);
        table_copy(dst: TableIndex, src: TableIndex);
        table_init(table: TableIndex, elem: ElemIndex);
    }
}

impl VisitReference for Log<'_> {
    note! {
        ref_i31();
        struct_new(ty: TypeIndex);
    }
}

impl VisitVector for Log<'_> {
    fn vector_load(&mut self, op: VectorLoadOp, _: MemArg) -> Result<(), Pause> {
        self.note("load", &[&op, &op.log2_bytes()])
    }

    note! {
        v128_const(bits: u128);
        vector_splat(ty: LaneType);
        vector_extract_lane(ty: LaneType, sign: Sign, lane: u8);
        vector_replace_lane(ty: LaneType, lane: u8);
        vector_unary(op: VectorUnary);
        vector_binary(op: VectorBinary);
        vector_ternary(op: VectorTernary);
        vector_shift(op: VectorShift);
        vector_reduce(op: VectorReduce);
    }
}

fn function(code: &[u8]) -> Module {
    valid(&with_body(0, &[&[0], code, &[END]].concat()))
}

fn visited(code: &[u8]) -> String {
    let mut log = Log::default();
    function(code)
        .body(CodeIndex(0))
        .driver()
        .run(&mut log)
        .unwrap();
    log.text()
}

/// The validator lets any instruction follow `unreachable`, and the driver can start behind it.
fn decoded(instruction: &[u8]) -> Option<String> {
    let body = [&[0, UNREACHABLE], instruction, &[UNREACHABLE, END]].concat();
    let module = support::parse(&with_body(0, &body)).ok()?;
    let mut log = Log::default();
    module
        .body(CodeIndex(0))
        .driver_at(2)
        .run(&mut log)
        .unwrap();
    assert_eq!(log.lines[1..], ["unreachable", "end Dead"]);
    Some(log.lines.swap_remove(0))
}

fn decoded_range(prefix: &[u8], numbers: impl Iterator<Item = usize>, immediates: &[u8]) -> String {
    let number = |n| {
        if prefix.is_empty() {
            vec![n as u8]
        } else {
            unsigned(n)
        }
    };
    let lines = numbers.map(|n| decoded(&[prefix, &number(n), immediates].concat()).unwrap());
    lines.collect::<Vec<_>>().join("; ")
}

#[test]
fn unreachable_code_is_skipped() {
    let dead = [
        BLOCK, EMPTY, I32_CONST, END, IF, EMPTY, ELSE, END, TRY, EMPTY, DELEGATE, 0, END, NOP,
    ];
    let transfers: [&[u8]; 9] = [
        &[UNREACHABLE],
        &[BR, 0],
        &[I32_CONST, 0, BR_TABLE, 0, 0],
        &[RETURN],
        &[THROW, 0],
        &[REF_NULL, support::EXNREF, THROW_REF],
        &[RETURN_CALL, 0],
        &[I32_CONST, 0, RETURN_CALL_INDIRECT, 0, 0],
        &[REF_NULL, 0, RETURN_CALL_REF, 0],
    ];
    for transfer in transfers {
        let text = visited(&[&[BLOCK, EMPTY], transfer, &dead, &[END, NOP]].concat());
        assert!(text.ends_with("; end Dead; nop; end Live"), "{text}");
        assert_eq!(text.split("block").count(), 2, "{text}");
    }

    let cases: [(&[u8], &str); 5] = [
        (
            &[I32_CONST, 1, IF, EMPTY, BR, 0, NOP, ELSE, NOP, END],
            "i32_const 1; if_ Empty; br 0; else_ Dead; nop; end Live; end Live",
        ),
        (
            &[I32_CONST, 1, IF, EMPTY, NOP, ELSE, BR, 1, NOP, END],
            "i32_const 1; if_ Empty; nop; else_ Live; br 1; end Dead; end Live",
        ),
        (
            &[
                TRY, EMPTY, BR, 0, NOP, CATCH, 0, RETHROW, 0, NOP, CATCH_ALL, NOP, END,
            ],
            "try_ Empty; br 0; catch TagIndex(0) Dead; other; catch_all Dead; nop; end Live; end Live",
        ),
        (
            &[
                TRY,
                EMPTY,
                UNREACHABLE,
                NOP,
                DELEGATE,
                0,
                TRY,
                EMPTY,
                DELEGATE,
                0,
            ],
            "try_ Empty; unreachable; delegate 0 Dead; try_ Empty; delegate 0 Live; end Live",
        ),
        (&[UNREACHABLE, NOP], "unreachable; end Dead"),
    ];
    for (code, expected) in cases {
        assert_eq!(visited(code), expected);
    }
}

#[test]
fn skipped_loops_and_calls_count() {
    let code = [
        CALL,
        0,
        BLOCK,
        EMPTY,
        BR,
        0,
        LOOP,
        EMPTY,
        CALL,
        0,
        RETURN_CALL,
        0,
        END,
        END,
        LOOP,
        EMPTY,
        I32_CONST,
        0,
        CALL_INDIRECT,
        9,
        0,
        END,
    ];
    assert_eq!(
        visited(&code),
        "call 0 0; block Empty; br 0; end Dead; loop_ Empty 1; i32_const 0; \
         call_indirect TypeIndex(0) TableIndex(0) 3; end Live; end Live"
    );
}

#[test]
fn the_visitor_can_end_the_flow() {
    let module = function(&[
        I32_CONST,
        0,
        IF,
        EMPTY,
        NOP,
        ELSE,
        NOP,
        END,
        BLOCK,
        EMPTY,
        BLOCK,
        EMPTY,
        UNREACHABLE,
        END,
        NOP,
        END,
        NOP,
    ]);
    let run = |dead_after| {
        let mut log = Log {
            dead_after,
            ..Log::default()
        };
        module.body(CodeIndex(0)).driver().run(&mut log).unwrap();
        log.offsets
    };
    assert_eq!(run(&[]), [1, 3, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18]);
    assert_eq!(run(&[3]), [1, 3, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18]);
    assert_eq!(
        run(&[6, 13, 14]),
        [1, 3, 5, 6, 8, 9, 11, 13, 14, 16, 17, 18]
    );
    assert_eq!(run(&[8]), [1, 3, 5, 6, 7, 8, 18]);
}

#[test]
fn the_driver_goes_on_after_an_error() {
    let code = [
        CALL, 0, BLOCK, EMPTY, BR, 0, NOP, END, LOOP, EMPTY, CALL, 0, END,
    ];
    let module = function(&code);
    let mut log = Log {
        pause_at: &[1, 5, 8, 9, 14],
        ..Log::default()
    };
    let mut driver = module.body(CodeIndex(0)).driver();
    let mut pauses = Vec::new();
    while driver.run(&mut log).is_err() {
        pauses.push(driver.offset());
    }
    assert_eq!(pauses, [3, 7, 9, 11, 15]);
    assert_eq!(log.text(), visited(&code));
}

#[test]
fn drivers_nest() {
    let module = function(&[CALL, 2, DROP, DROP, CALL, 2, DROP, DROP]);
    let mut log = Log {
        inline_from: Some(&module),
        ..Log::default()
    };
    module.body(CodeIndex(0)).driver().run(&mut log).unwrap();
    assert_eq!(
        log.text(),
        "call 2 0; unreachable; end Dead; other; other; call 2 1; unreachable; end Dead; other; other; end Live"
    );
}

#[test]
fn immediates() {
    let cases: &[(&[u8], &str)] = &[
        (
            &[I32_CONST, 0x80, 0x80, 0x80, 0x80, 0x78],
            "i32_const -2147483648",
        ),
        (
            &[
                I64_CONST, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0,
            ],
            "i64_const 9223372036854775807",
        ),
        (&[F32_CONST, 1, 2, 0, 0], "f32_const 513"),
        (&[F64_CONST, 0, 0, 0, 0, 1, 0, 0, 0], "f64_const 4294967296"),
        (
            &[
                VECTOR_PREFIX,
                0x0c,
                1,
                1,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ],
            "v128_const 257",
        ),
        (
            &[I64_LOAD16_S, 0x41, 1, 0x80, 0x80, 0x80, 0x80, 0x10],
            "load I64 S16 Signed 1 4294967296",
        ),
        (&[F32_STORE, 0x82, 0, 0x81, 1], "store F32 S32 0 129"),
        (
            &[MISC_PREFIX, 8, 0, 1],
            "memory_init MemoryIndex(1) DataIndex(0)",
        ),
        (
            &[MISC_PREFIX, 10, 1, 0],
            "memory_copy MemoryIndex(1) MemoryIndex(0)",
        ),
        (
            &[MISC_PREFIX, 0x8c, 0, 0, 0],
            "table_init TableIndex(0) ElemIndex(0)",
        ),
        (
            &[MISC_PREFIX, 14, 1, 1],
            "table_copy TableIndex(1) TableIndex(1)",
        ),
    ];
    for &(instruction, expected) in cases {
        assert_eq!(decoded(instruction).unwrap(), expected);
    }
    assert_eq!(
        visited(&[BLOCK, 9, I32_CONST, 0, BR_TABLE, 3, 1, 0x80, 0, 1, 0, END]),
        "block Func(TypeIndex(0)); i32_const 0; br_table [1, 0, 1] 0; end Dead; end Live"
    );
    assert_eq!(
        visited(&[
            BLOCK,
            support::EXNREF,
            TRY_TABLE,
            EMPTY,
            4,
            0,
            0,
            1,
            1,
            0,
            0,
            2,
            1,
            3,
            0,
            END,
            BR,
            1,
            END,
            DROP
        ]),
        "block Value((ref null exnref)); try_table Empty [(Some(0), false, 1), (Some(0), true, 0), \
         (None, false, 1), (None, true, 0)]; end Live; br 1; end Dead; other; end Live"
    );
    assert_eq!(
        visited(&[
            BLOCK,
            support::ANYREF,
            REF_NULL,
            4,
            GC_PREFIX,
            24,
            1,
            0,
            4,
            5,
            END,
            DROP
        ]),
        "block Value((ref null any)); other; br_on_cast 0 (ref null <struct:4>) (ref <struct:5>); end Live; \
         other; end Live"
    );
}

#[test]
fn scalar_operations() {
    let both = |widths: [&str; 2], text: &str| widths.map(|width| text.replace('#', width));
    let [i32_tests, i64_tests] = both(
        ["W32", "W64"],
        "int_eqz #; int_compare # Eq; int_compare # Ne; int_compare # Lt; int_compare # Below; int_compare # Gt; \
         int_compare # Above; int_compare # Le; int_compare # BelowEq; int_compare # Ge; int_compare # AboveEq",
    );
    let [f32_tests, f64_tests] = both(
        ["F32", "F64"],
        "float_compare # Eq; float_compare # NeOrUnordered; float_compare # Lt; float_compare # Gt; \
         float_compare # Le; float_compare # Ge",
    );
    let [i32_ops, i64_ops] = both(
        ["W32", "W64"],
        "int_unary # Clz; int_unary # Ctz; int_unary # Popcnt; int_binary # Add; int_binary # Sub; \
         int_binary # Mul; int_div # Signed; int_div # Unsigned; int_rem # Signed; int_rem # Unsigned; \
         int_binary # And; int_binary # Or; int_binary # Xor; int_shift # Left; int_shift # RightArithmetic; \
         int_shift # RightLogical; int_shift # RotateLeft; int_shift # RotateRight",
    );
    let [f32_ops, f64_ops] = both(
        ["F32", "F64"],
        "float_unary # Abs; float_unary # Neg; float_round # Up; float_round # Down; float_round # TowardZero; \
         float_round # Nearest; float_unary # Sqrt; float_binary # Add; float_binary # Sub; float_binary # Mul; \
         float_binary # Div; float_binary # Min; float_binary # Max; float_binary # Copysign",
    );
    let truncations = "@ F32 Signed #; @ F32 Unsigned #; @ F64 Signed #; @ F64 Unsigned #";
    let [to_i32, to_i64] = both(["W32", "W64"], &truncations.replace('@', "truncate_float"));
    let [to_f32, to_f64] = both(
        ["F32", "F64"],
        "convert_int_to_float Signed W32 #; convert_int_to_float Unsigned W32 #; \
         convert_int_to_float Signed W64 #; convert_int_to_float Unsigned W64 #",
    );
    assert_eq!(
        decoded_range(&[], 0x45..=0xc4, &[]),
        format!(
            "{i32_tests}; {i64_tests}; {f32_tests}; {f64_tests}; {i32_ops}; {i64_ops}; {f32_ops}; {f64_ops}; \
             i32_wrap_i64; {to_i32}; i64_extend_i32 Signed; i64_extend_i32 Unsigned; {to_i64}; {to_f32}; \
             f32_demote_f64; {to_f64}; f64_promote_f32; reinterpret_float_as_int F32; \
             reinterpret_float_as_int F64; reinterpret_int_as_float F32; reinterpret_int_as_float F64; \
             int_sign_extend W32 S8; int_sign_extend W32 S16; int_sign_extend W64 S8; int_sign_extend W64 S16; \
             int_sign_extend W64 S32"
        )
    );
    assert_eq!(
        decoded_range(&[MISC_PREFIX], 0..8, &[]),
        both(
            ["W32", "W64"],
            &truncations.replace('@', "truncate_float_saturating")
        )
        .join("; ")
    );
    assert_eq!(
        decoded_range(&[MISC_PREFIX], 19..=22, &[]),
        "i64_add128; i64_sub128; i64_mul_wide Signed; i64_mul_wide Unsigned"
    );
}

#[test]
fn memory_operations() {
    assert_eq!(
        decoded_range(&[], 0x28..=0x3e, &[0, 0]).replace(" 0 0", ""),
        "load I32 S32 Unsigned; load I64 S64 Unsigned; load F32 S32 Unsigned; load F64 S64 Unsigned; \
         load I32 S8 Signed; load I32 S8 Unsigned; load I32 S16 Signed; load I32 S16 Unsigned; \
         load I64 S8 Signed; load I64 S8 Unsigned; load I64 S16 Signed; load I64 S16 Unsigned; \
         load I64 S32 Signed; load I64 S32 Unsigned; store I32 S32; store I64 S64; store F32 S32; store F64 S64; \
         store I32 S8; store I32 S16; store I64 S8; store I64 S16; store I64 S32"
    );
    let families = [
        "load", "store", "Add", "Sub", "And", "Or", "Xor", "Exchange", "cmpxchg",
    ];
    let forms = [
        "W32 S32", "W64 S64", "W32 S8", "W32 S16", "W64 S8", "W64 S16", "W64 S32",
    ];
    let all = families
        .iter()
        .flat_map(|family| forms.iter().map(move |form| format!("{family} {form}")));
    for (expected, number) in all.zip(0x10..) {
        let with_alignment = |alignment| decoded(&[ATOMIC_PREFIX, number, alignment, 0]);
        assert_eq!(
            (0..5).filter_map(with_alignment).collect::<Vec<_>>(),
            [expected]
        );
    }
}

#[test]
fn vector_operations() {
    assert_eq!(
        decoded_range(&[VECTOR_PREFIX], (0..=0x0a).chain(0x5c..=0x5d), &[0, 0]),
        "load Whole 4; load Extend(S8, Signed) 3; load Extend(S8, Unsigned) 3; load Extend(S16, Signed) 3; \
         load Extend(S16, Unsigned) 3; load Extend(S32, Signed) 3; load Extend(S32, Unsigned) 3; \
         load Splat(S8) 0; load Splat(S16) 1; load Splat(S32) 2; load Splat(S64) 3; load Zero(F32) 2; \
         load Zero(F64) 3"
    );
    assert_eq!(
        decoded_range(&[VECTOR_PREFIX], 0x0f..=0x14, &[]).replace("vector_splat ", ""),
        "Int(S8); Int(S16); Int(S32); Int(S64); Float(F32); Float(F64)"
    );
    assert_eq!(
        decoded_range(&[VECTOR_PREFIX], 0x15..=0x22, &[1])
            .replace("vector_", "")
            .replace("_lane", ""),
        "extract Int(S8) Signed 1; extract Int(S8) Unsigned 1; replace Int(S8) 1; extract Int(S16) Signed 1; \
         extract Int(S16) Unsigned 1; replace Int(S16) 1; extract Int(S32) Unsigned 1; replace Int(S32) 1; \
         extract Int(S64) Unsigned 1; replace Int(S64) 1; extract Float(F32) Unsigned 1; replace Float(F32) 1; \
         extract Float(F64) Unsigned 1; replace Float(F64) 1"
    );

    // WebAssembly Core, "Index of Instructions". A dash stands for a number that is no operation on lanes alone.
    let compare =
        |shape: &str| "#Eq #Ne #LtS #LtU #GtS #GtU #LeS #LeU #GeS #GeU".replace('#', shape);
    let float_compare = |shape: &str| "#Eq #Ne #Lt #Gt #Le #Ge".replace('#', shape);
    let float = |shape: &str| {
        "#Abs #Neg - #Sqrt #Add #Sub #Mul #Div #Min #Max #Pmin #Pmax".replace('#', shape)
    };
    let widen = |name: &str, from: &str| {
        format!("{name}Low{from}S {name}High{from}S {name}Low{from}U {name}High{from}U")
    };
    let expected = [
        compare("I8x16"),
        compare("I16x8"),
        compare("I32x4"),
        float_compare("F32x4"),
        float_compare("F64x2"),
        "Not And AndNot Or Xor Bitselect AnyTrue - - - - - - - - - - F32x4DemoteF64x2Zero F64x2PromoteLowF32x4 \
         I8x16Abs I8x16Neg I8x16Popcnt I8x16AllTrue I8x16Bitmask I8x16NarrowI16x8S I8x16NarrowI16x8U F32x4Ceil \
         F32x4Floor F32x4Trunc F32x4Nearest I8x16Shl I8x16ShrS I8x16ShrU I8x16Add I8x16AddSatS I8x16AddSatU \
         I8x16Sub I8x16SubSatS I8x16SubSatU F64x2Ceil F64x2Floor I8x16MinS I8x16MinU I8x16MaxS I8x16MaxU \
         F64x2Trunc I8x16AvgrU I16x8ExtAddPairwiseI8x16S I16x8ExtAddPairwiseI8x16U I32x4ExtAddPairwiseI16x8S \
         I32x4ExtAddPairwiseI16x8U I16x8Abs I16x8Neg I16x8Q15MulrSatS I16x8AllTrue I16x8Bitmask \
         I16x8NarrowI32x4S I16x8NarrowI32x4U"
            .into(),
        widen("I16x8Extend", "I8x16"),
        "I16x8Shl I16x8ShrS I16x8ShrU I16x8Add I16x8AddSatS I16x8AddSatU I16x8Sub I16x8SubSatS I16x8SubSatU \
         F64x2Nearest I16x8Mul I16x8MinS I16x8MinU I16x8MaxS I16x8MaxU - I16x8AvgrU"
            .into(),
        widen("I16x8ExtMul", "I8x16"),
        "I32x4Abs I32x4Neg - I32x4AllTrue I32x4Bitmask - -".into(),
        widen("I32x4Extend", "I16x8"),
        "I32x4Shl I32x4ShrS I32x4ShrU I32x4Add - - I32x4Sub - - - I32x4Mul I32x4MinS I32x4MinU I32x4MaxS \
         I32x4MaxU I32x4DotI16x8S -"
            .into(),
        widen("I32x4ExtMul", "I16x8"),
        "I64x2Abs I64x2Neg - I64x2AllTrue I64x2Bitmask - -".into(),
        widen("I64x2Extend", "I32x4"),
        "I64x2Shl I64x2ShrS I64x2ShrU I64x2Add - - I64x2Sub - - - I64x2Mul I64x2Eq I64x2Ne I64x2LtS I64x2GtS \
         I64x2LeS I64x2GeS"
            .into(),
        widen("I64x2ExtMul", "I32x4"),
        float("F32x4"),
        float("F64x2"),
        "I32x4TruncSatF32x4S I32x4TruncSatF32x4U F32x4ConvertI32x4S F32x4ConvertI32x4U I32x4TruncSatF64x2SZero \
         I32x4TruncSatF64x2UZero F64x2ConvertLowI32x4S F64x2ConvertLowI32x4U I8x16RelaxedSwizzle \
         I32x4RelaxedTruncF32x4S I32x4RelaxedTruncF32x4U I32x4RelaxedTruncF64x2SZero I32x4RelaxedTruncF64x2UZero \
         F32x4RelaxedMadd F32x4RelaxedNmadd F64x2RelaxedMadd F64x2RelaxedNmadd I8x16RelaxedLaneselect \
         I16x8RelaxedLaneselect I32x4RelaxedLaneselect I64x2RelaxedLaneselect F32x4RelaxedMin F32x4RelaxedMax \
         F64x2RelaxedMin F64x2RelaxedMax I16x8RelaxedQ15MulrS I16x8RelaxedDotI8x16I7x16S \
         I32x4RelaxedDotI8x16I7x16AddS - I8x16Swizzle"
            .into(),
    ];
    let name = |number| match decoded(&[&[VECTOR_PREFIX][..], &unsigned(number)].concat()) {
        Some(line) => line.rsplit(' ').next().unwrap().to_string(),
        None => "-".into(),
    };
    let names: Vec<_> = (0x23..=0x114).chain([0x0e]).map(name).collect();
    assert_eq!(names.join(" "), expected.join(" "));

    let count = VectorUnary::ALL.len()
        + VectorBinary::ALL.len()
        + VectorTernary::ALL.len()
        + VectorShift::ALL.len()
        + VectorReduce::ALL.len();
    assert_eq!(names.iter().filter(|name| *name != "-").count(), count);
}

#[test]
fn constant_expressions() {
    let vector = [&[V128, 0, VECTOR_PREFIX, 0x0c, 7][..], &[0; 15], &[END]].concat();
    let object = [
        support::REF,
        0,
        0,
        I32_CONST,
        1,
        GC_PREFIX,
        28,
        GC_PREFIX,
        0,
        1,
        END,
    ];
    let module = valid(&module(&[
        (
            support::TYPE,
            &list(&[&[support::STRUCT, 1, support::ANYREF, 0][..]; 2]),
        ),
        (support::GLOBAL, &list(&[&vector, &object])),
    ]));
    let evaluated = |global: &Global| {
        let Some(ConstExpr::Code(code)) = global.init else {
            panic!();
        };
        let mut log = Log::default();
        module.const_expr_driver(code).run(&mut log).unwrap();
        log.text()
    };
    assert_eq!(
        module.globals().iter().map(evaluated).collect::<Vec<_>>(),
        [
            "v128_const 7; end Live",
            "i32_const 1; ref_i31; struct_new TypeIndex(0); end Live"
        ]
    );
}

#[test]
fn bodies() {
    let module = valid(&module(&[
        (support::TYPE, &list(&[&[FUNC, 0, 0], &[FUNC, 1, I32, 0]])),
        (support::IMPORT, &list(&[&[0, 0, 0, 0]])),
        (support::FUNCTION, &list_of(2, |i| vec![i as u8])),
        (
            support::CODE,
            &code(&[
                &[0, END],
                &[3, 2, I64, 0, V128, 1, support::NULLABLE, 0, END],
            ]),
        ),
    ]));
    let body = module.body(CodeIndex(1));
    assert_eq!(
        (body.code_index(), body.func_index()),
        (CodeIndex(1), FuncIndex(2))
    );
    assert_eq!(
        (body.type_index(), body.func_type().params),
        (TypeIndex(1), &[ValType::I32][..])
    );
    let reference = module.types().heap_type(TypeIndex(0)).nullable().into();
    assert_eq!(
        body.local_groups().collect::<Vec<_>>(),
        [(2, ValType::I64), (0, ValType::V128), (1, reference)]
    );
    assert_eq!((body.facts().local_count, body.facts().code_offset), (4, 8));
    assert_eq!(body.bytes(), module.bytes(module.body_span(CodeIndex(1))));
}

#[test]
fn effects_of_loops() {
    let set = |local| [I32_CONST, 0, LOCAL_SET, local];
    let body = [
        &[1, 5, I32][..],
        &set(0),
        &[LOOP, EMPTY],
        &set(1),
        &set(1),
        &[
            BLOCK,
            EMPTY,
            LOOP,
            EMPTY,
            I32_CONST,
            0,
            LOCAL_TEE,
            2,
            MEMORY_GROW,
            0,
            DROP,
            END,
            END,
        ],
        &[TRY, EMPTY, LOOP, EMPTY, CALL, 0],
        &set(1),
        &[END, DELEGATE, 0, END],
        &set(3),
        &[LOOP, EMPTY],
        &set(3),
        &[BR, 0, LOOP, EMPTY],
        &set(4),
        &[END, END, END],
    ];
    let module = valid(&with_body(0, &body.concat()));
    let mut effects = LoopEffects::default();
    effects.scan(&module.body(CodeIndex(0)));
    let assigned = |index| effects.assigned_locals(index);
    assert_eq!(
        [0, 1, 2, 3, 4].map(assigned),
        [&[1, 2, 1][..], &[2], &[1], &[3], &[]]
    );
    assert_eq!(
        [0, 1, 2, 3, 4].map(|index| effects.flags(index)),
        [
            LoopFlags::CALLS | LoopFlags::GROWS_MEMORY | LoopFlags::HAS_INNER_LOOP,
            LoopFlags::GROWS_MEMORY,
            LoopFlags::CALLS,
            LoopFlags::empty(),
            LoopFlags::empty(),
        ]
    );
}
