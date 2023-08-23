import {
  dlopen,
  FFIType,
  suffix,
  CString,
  Pointer,
  JSCallback,
  read,
  // FFIFunction,
  // ConvertFns,
  // Narrow,
} from "bun:ffi";
import * as tsd from "tsd";
import * as tc from "conditional-type-checks";

// `suffix` is either "dylib", "so", or "dll" depending on the platform
// you don't have to use "suffix", it's just there for convenience
const path = `libsqlite3.${suffix}`;

const lib = dlopen(
  path, // a library name or file path
  {
    sqlite3_libversion: {
      // no arguments, returns a string
      args: [],
      returns: FFIType.cstring,
    },
    add: {
      args: [FFIType.i32, FFIType.i32],
      returns: FFIType.i32,
    },
    ptr_type: {
      args: [FFIType.pointer],
      returns: FFIType.pointer,
    },
    fn_type: {
      args: [FFIType.function],
      returns: FFIType.function,
    },
    allArgs: {
      args: [
        FFIType.char, // string
        FFIType.int8_t,
        FFIType.i8,
        FFIType.uint8_t,
        FFIType.u8,
        FFIType.int16_t,
        FFIType.i16,
        FFIType.uint16_t,
        FFIType.u16,
        FFIType.int32_t,
        FFIType.i32,
        FFIType.int,
        FFIType.uint32_t,
        FFIType.u32,
        FFIType.int64_t,
        FFIType.i64,
        FFIType.uint64_t,
        FFIType.u64,
        FFIType.double,
        FFIType.f64,
        FFIType.float,
        FFIType.f32,
        FFIType.bool,
        FFIType.ptr,
        FFIType.pointer,
        FFIType.void,
        FFIType.cstring,
        FFIType.i64_fast,
        FFIType.u64_fast,
      ],
      returns: FFIType.void,
    },
  },
);

tsd.expectType<CString>(lib.symbols.sqlite3_libversion());
tsd.expectType<number>(lib.symbols.add(1, 2));

tsd.expectType<Pointer | null>(lib.symbols.ptr_type(0));
tc.assert<
  tc.IsExact<
    (typeof lib)["symbols"]["ptr_type"],
    TypedArray | Pointer | CString
  >
>;

tsd.expectType<Pointer | null>(lib.symbols.fn_type(0));
tc.assert<tc.IsExact<(typeof lib)["symbols"]["fn_type"], Pointer | JSCallback>>;

tc.assert<
  tc.IsExact<
    (typeof lib)["symbols"]["allArgs"],
    [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      boolean,
      Pointer,
      Pointer,
      void,
      CString,
      number | bigint,
      number | bigint,
    ]
  >
>;

const as_const_test = {
  sqlite3_libversion: {
    args: [],
    returns: FFIType.cstring,
  },
  multi_args: {
    args: [FFIType.i32, FFIType.f32],
    returns: FFIType.void,
  },
  no_returns: {
    args: [FFIType.i32],
  },
  no_args: {
    returns: FFIType.i32,
  },
} as const;

const lib2 = dlopen(path, as_const_test);

tsd.expectType<CString>(lib2.symbols.sqlite3_libversion());
tsd.expectType<void>(lib2.symbols.multi_args(1, 2));
tc.assert<tc.IsExact<ReturnType<(typeof lib2)["symbols"]["no_returns"]>, void>>;
tc.assert<tc.IsExact<Parameters<(typeof lib2)["symbols"]["no_args"]>, []>>;

tsd.expectType<number>(read.u8(0));
tsd.expectType<number>(read.u8(0, 0));
tsd.expectType<number>(read.i8(0, 0));
tsd.expectType<number>(read.u16(0, 0));
tsd.expectType<number>(read.i16(0, 0));
tsd.expectType<number>(read.u32(0, 0));
tsd.expectType<number>(read.i32(0, 0));
tsd.expectType<bigint>(read.u64(0, 0));
tsd.expectType<bigint>(read.i64(0, 0));
tsd.expectType<number>(read.f32(0, 0));
tsd.expectType<number>(read.f64(0, 0));
tsd.expectType<number>(read.ptr(0, 0));
tsd.expectType<number>(read.intptr(0, 0));
