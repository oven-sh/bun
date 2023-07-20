import {
  dlopen,
  FFIType,
  suffix,
  CString,
  Pointer,
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
