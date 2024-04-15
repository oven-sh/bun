import { CString, dlopen, FFIType, Pointer, read, suffix } from "bun:ffi";
import * as tsd from "./utilities.test";

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

tsd.expectType<Pointer | null>(lib.symbols.fn_type(0));

function _arg(
  ...params: [
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
    // tslint:disable-next-line: void-return
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    void,
    CString,
    number | bigint,
    number | bigint,
  ]
) {
  console.log("asdf");
}
_arg;

type libParams = Parameters<(typeof lib)["symbols"]["allArgs"]>;
tsd.expectTypeEquals<libParams[0], number>(true);
tsd.expectTypeEquals<libParams[1], number>(true);
tsd.expectTypeEquals<libParams[2], number>(true);
tsd.expectTypeEquals<libParams[3], number>(true);
tsd.expectTypeEquals<libParams[4], number>(true);
tsd.expectTypeEquals<libParams[5], number>(true);
tsd.expectTypeEquals<libParams[6], number>(true);
tsd.expectTypeEquals<libParams[7], number>(true);
tsd.expectTypeEquals<libParams[8], number>(true);
tsd.expectTypeEquals<libParams[9], number>(true);
tsd.expectTypeEquals<libParams[10], number>(true);
tsd.expectTypeEquals<libParams[11], number>(true);
tsd.expectTypeEquals<libParams[12], number>(true);
tsd.expectTypeEquals<libParams[13], number>(true);
tsd.expectTypeEquals<libParams[14], number>(true);
tsd.expectTypeEquals<libParams[15], number>(true);
tsd.expectTypeEquals<libParams[16], number>(true);
tsd.expectTypeEquals<libParams[17], number>(true);
tsd.expectTypeEquals<libParams[18], number>(true);
tsd.expectTypeEquals<libParams[19], number>(true);
tsd.expectTypeEquals<libParams[20], number>(true);
tsd.expectTypeEquals<libParams[21], number>(true);
tsd.expectTypeEquals<libParams[22], boolean>(true);
tsd.expectTypeEquals<libParams[23], Pointer>(true);
tsd.expectTypeEquals<libParams[24], Pointer>(true);
tsd.expectTypeEquals<libParams[25], undefined>(true);
tsd.expectTypeEquals<libParams[26], CString>(true);
tsd.expectTypeEquals<libParams[27], number | bigint>(true);
tsd.expectTypeEquals<libParams[28], number | bigint>(true);

// tslint:disable-next-line:no-object-literal-type-assertion
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
// tslint:disable-next-line:no-void-expression
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
tsd.expectType<void>(lib2.symbols.multi_args(1, 2));
tsd.expectTypeEquals<ReturnType<(typeof lib2)["symbols"]["no_returns"]>, undefined>(true);
tsd.expectTypeEquals<Parameters<(typeof lib2)["symbols"]["no_args"]>, []>(true);

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
