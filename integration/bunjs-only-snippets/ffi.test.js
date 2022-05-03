import { describe, it, expect } from "bun:test";
import { unsafe } from "bun";
//
import {
  native,
  viewSource,
  dlopen,
  CString,
  ptr,
  toBuffer,
  toArrayBuffer,
  FFIType,
  callback,
} from "bun:ffi";

it("ffi print", async () => {
  await Bun.write(
    import.meta.dir + "/ffi.test.fixture.callback.c",
    viewSource(
      {
        return_type: "bool",
        args: ["ptr"],
      },
      true
    )
  );
  await Bun.write(
    import.meta.dir + "/ffi.test.fixture.receiver.c",
    viewSource(
      {
        not_a_callback: {
          return_type: "float",
          args: ["float"],
        },
      },
      false
    )[0]
  );
  expect(
    viewSource(
      {
        return_type: "int8_t",
        args: [],
      },
      true
    ).length > 0
  ).toBe(true);
  expect(
    viewSource(
      {
        a: {
          return_type: "int8_t",
          args: [],
        },
      },
      false
    ).length > 0
  ).toBe(true);
});

it("ffi run", () => {
  const types = {
    returns_true: {
      return_type: "bool",
      args: [],
    },
    returns_false: {
      return_type: "bool",
      args: [],
    },
    returns_42_char: {
      return_type: "char",
      args: [],
    },
    returns_42_float: {
      return_type: "float",
      args: [],
    },
    returns_42_double: {
      return_type: "double",
      args: [],
    },
    returns_42_uint8_t: {
      return_type: "uint8_t",
      args: [],
    },
    returns_neg_42_int8_t: {
      return_type: "int8_t",
      args: [],
    },
    returns_42_uint16_t: {
      return_type: "uint16_t",
      args: [],
    },
    returns_42_uint32_t: {
      return_type: "uint32_t",
      args: [],
    },
    returns_42_uint64_t: {
      return_type: "uint64_t",
      args: [],
    },
    returns_neg_42_int16_t: {
      return_type: "int16_t",
      args: [],
    },
    returns_neg_42_int32_t: {
      return_type: "int32_t",
      args: [],
    },
    returns_neg_42_int64_t: {
      return_type: "int64_t",
      args: [],
    },

    identity_char: {
      return_type: "char",
      args: ["char"],
    },
    identity_float: {
      return_type: "float",
      args: ["float"],
    },
    identity_bool: {
      return_type: "bool",
      args: ["bool"],
    },
    identity_double: {
      return_type: "double",
      args: ["double"],
    },
    identity_int8_t: {
      return_type: "int8_t",
      args: ["int8_t"],
    },
    identity_int16_t: {
      return_type: "int16_t",
      args: ["int16_t"],
    },
    identity_int32_t: {
      return_type: "int32_t",
      args: ["int32_t"],
    },
    identity_int64_t: {
      return_type: "int64_t",
      args: ["int64_t"],
    },
    identity_uint8_t: {
      return_type: "uint8_t",
      args: ["uint8_t"],
    },
    identity_uint16_t: {
      return_type: "uint16_t",
      args: ["uint16_t"],
    },
    identity_uint32_t: {
      return_type: "uint32_t",
      args: ["uint32_t"],
    },
    identity_uint64_t: {
      return_type: "uint64_t",
      args: ["uint64_t"],
    },

    add_char: {
      return_type: "char",
      args: ["char", "char"],
    },
    add_float: {
      return_type: "float",
      args: ["float", "float"],
    },
    add_double: {
      return_type: "double",
      args: ["double", "double"],
    },
    add_int8_t: {
      return_type: "int8_t",
      args: ["int8_t", "int8_t"],
    },
    add_int16_t: {
      return_type: "int16_t",
      args: ["int16_t", "int16_t"],
    },
    add_int32_t: {
      return_type: "int32_t",
      args: ["int32_t", "int32_t"],
    },
    add_int64_t: {
      return_type: "int64_t",
      args: ["int64_t", "int64_t"],
    },
    add_uint8_t: {
      return_type: "uint8_t",
      args: ["uint8_t", "uint8_t"],
    },
    add_uint16_t: {
      return_type: "uint16_t",
      args: ["uint16_t", "uint16_t"],
    },
    add_uint32_t: {
      return_type: "uint32_t",
      args: ["uint32_t", "uint32_t"],
    },

    does_pointer_equal_42_as_int32_t: {
      return_type: "bool",
      args: ["ptr"],
    },

    ptr_should_point_to_42_as_int32_t: {
      return_type: "ptr",
      args: [],
    },
    identity_ptr: {
      return_type: "ptr",
      args: ["ptr"],
    },
    add_uint64_t: {
      return_type: "uint64_t",
      args: ["uint64_t", "uint64_t"],
    },

    cb_identity_true: {
      return_type: "bool",
      args: ["ptr"],
    },
    cb_identity_false: {
      return_type: "bool",
      args: ["ptr"],
    },
    cb_identity_42_char: {
      return_type: "char",
      args: ["ptr"],
    },
    cb_identity_42_float: {
      return_type: "float",
      args: ["ptr"],
    },
    cb_identity_42_double: {
      return_type: "double",
      args: ["ptr"],
    },
    cb_identity_42_uint8_t: {
      return_type: "uint8_t",
      args: ["ptr"],
    },
    cb_identity_neg_42_int8_t: {
      return_type: "int8_t",
      args: ["ptr"],
    },
    cb_identity_42_uint16_t: {
      return_type: "uint16_t",
      args: ["ptr"],
    },
    cb_identity_42_uint32_t: {
      return_type: "uint32_t",
      args: ["ptr"],
    },
    cb_identity_42_uint64_t: {
      return_type: "uint64_t",
      args: ["ptr"],
    },
    cb_identity_neg_42_int16_t: {
      return_type: "int16_t",
      args: ["ptr"],
    },
    cb_identity_neg_42_int32_t: {
      return_type: "int32_t",
      args: ["ptr"],
    },
    cb_identity_neg_42_int64_t: {
      return_type: "int64_t",
      args: ["ptr"],
    },

    return_a_function_ptr_to_function_that_returns_true: {
      return_type: "ptr",
      args: [],
    },
  };
  const {
    symbols: {
      returns_true,
      returns_false,
      return_a_function_ptr_to_function_that_returns_true,
      returns_42_char,
      returns_42_float,
      returns_42_double,
      returns_42_uint8_t,
      returns_neg_42_int8_t,
      returns_42_uint16_t,
      returns_42_uint32_t,
      returns_42_uint64_t,
      returns_neg_42_int16_t,
      returns_neg_42_int32_t,
      returns_neg_42_int64_t,
      identity_char,
      identity_float,
      identity_bool,
      identity_double,
      identity_int8_t,
      identity_int16_t,
      identity_int32_t,
      identity_int64_t,
      identity_uint8_t,
      identity_uint16_t,
      identity_uint32_t,
      identity_uint64_t,
      add_char,
      add_float,
      add_double,
      add_int8_t,
      add_int16_t,
      add_int32_t,
      add_int64_t,
      add_uint8_t,
      add_uint16_t,
      identity_ptr,
      add_uint32_t,
      add_uint64_t,
      does_pointer_equal_42_as_int32_t,
      ptr_should_point_to_42_as_int32_t,
      cb_identity_true,
      cb_identity_false,
      cb_identity_42_char,
      cb_identity_42_float,
      cb_identity_42_double,
      cb_identity_42_uint8_t,
      cb_identity_neg_42_int8_t,
      cb_identity_42_uint16_t,
      cb_identity_42_uint32_t,
      cb_identity_42_uint64_t,
      cb_identity_neg_42_int16_t,
      cb_identity_neg_42_int32_t,
      cb_identity_neg_42_int64_t,
    },
    close,
  } = dlopen("/tmp/bun-ffi-test.dylib", types);

  expect(returns_true()).toBe(true);

  expect(returns_false()).toBe(false);

  expect(returns_42_char()).toBe(42);
  expect(returns_42_uint64_t().valueOf()).toBe(42);

  expect(Math.fround(returns_42_float())).toBe(Math.fround(42.41999804973602));
  expect(returns_42_double()).toBe(42.42);
  expect(returns_42_uint8_t()).toBe(42);
  expect(returns_neg_42_int8_t()).toBe(-42);
  expect(returns_42_uint16_t()).toBe(42);
  expect(returns_42_uint32_t()).toBe(42);
  expect(returns_42_uint64_t()).toBe(42);
  expect(returns_neg_42_int16_t()).toBe(-42);
  expect(returns_neg_42_int32_t()).toBe(-42);
  expect(identity_int32_t(10)).toBe(10);
  expect(returns_neg_42_int64_t()).toBe(-42);

  expect(identity_char(10)).toBe(10);

  expect(identity_float(10.199999809265137)).toBe(10.199999809265137);

  expect(identity_bool(true)).toBe(true);

  expect(identity_bool(false)).toBe(false);
  expect(identity_double(10.100000000000364)).toBe(10.100000000000364);

  expect(identity_int8_t(10)).toBe(10);
  expect(identity_int16_t(10)).toBe(10);
  expect(identity_int64_t(10)).toBe(10);
  expect(identity_uint8_t(10)).toBe(10);
  expect(identity_uint16_t(10)).toBe(10);
  expect(identity_uint32_t(10)).toBe(10);
  expect(identity_uint64_t(10)).toBe(10);

  var bigArray = new BigUint64Array(8);
  new Uint8Array(bigArray.buffer).fill(255);
  var bigIntArray = new BigInt64Array(bigArray.buffer);

  expect(identity_uint64_t(bigArray[0])).toBe(bigArray[0]);
  expect(identity_uint64_t(bigArray[0] - BigInt(1))).toBe(
    bigArray[0] - BigInt(1)
  );
  expect(add_uint64_t(BigInt(-1) * bigArray[0], bigArray[0])).toBe(0);
  expect(add_uint64_t(BigInt(-1) * bigArray[0] + BigInt(10), bigArray[0])).toBe(
    10
  );
  expect(identity_uint64_t(0)).toBe(0);
  expect(identity_uint64_t(100)).toBe(100);
  expect(identity_uint64_t(BigInt(100))).toBe(100);
  expect(identity_int64_t(bigIntArray[0])).toBe(bigIntArray[0]);
  expect(identity_int64_t(bigIntArray[0] - BigInt(1))).toBe(
    bigIntArray[0] - BigInt(1)
  );

  expect(add_char(1, 1)).toBe(2);
  expect(add_float(2.4, 2.8)).toBe(Math.fround(5.2));
  expect(add_double(4.2, 0.1)).toBe(4.3);
  expect(add_int8_t(1, 1)).toBe(2);
  expect(add_int16_t(1, 1)).toBe(2);
  expect(add_int32_t(1, 1)).toBe(2);
  expect(add_int64_t(1, 1)).toBe(2);
  expect(add_uint8_t(1, 1)).toBe(2);
  expect(add_uint16_t(1, 1)).toBe(2);
  expect(add_uint32_t(1, 1)).toBe(2);

  const cptr = ptr_should_point_to_42_as_int32_t();
  expect(cptr != 0).toBe(true);
  expect(typeof cptr === "number").toBe(true);
  expect(does_pointer_equal_42_as_int32_t(cptr)).toBe(true);
  const buffer = toBuffer(cptr, 0, 4);
  expect(buffer.readInt32(0)).toBe(42);
  expect(new DataView(toArrayBuffer(cptr, 0, 4), 0, 4).getInt32(0, true)).toBe(
    42
  );
  expect(ptr(buffer)).toBe(cptr);
  expect(new CString(cptr, 0, 1).toString()).toBe("*");
  expect(identity_ptr(cptr)).toBe(cptr);
  const second_ptr = ptr(new Buffer(8));
  expect(identity_ptr(second_ptr)).toBe(second_ptr);
  // function identityBool() {
  //   return true;
  // }
  // globalThis.identityBool = identityBool;

  // const first = native.callback(
  //   {
  //     return_type: "bool",
  //   },
  //   identityBool
  // );
  // expect(
  //   cb_identity_true(return_a_function_ptr_to_function_that_returns_true())
  // ).toBe(true);

  // expect(cb_identity_true(first)).toBe(true);

  // expect(
  //   cb_identity_false(
  //     callback(
  //       {
  //         return_type: "bool",
  //       },
  //       () => false
  //     )
  //   )
  // ).toBe(false);

  // expect(
  //   cb_identity_42_char(
  //     callback(
  //       {
  //         return_type: "char",
  //       },
  //       () => 42
  //     )
  //   )
  // ).toBe(42);
  // expect(
  //   cb_identity_42_uint8_t(
  //     callback(
  //       {
  //         return_type: "uint8_t",
  //       },
  //       () => 42
  //     )
  //   )
  // ).toBe(42);

  // cb_identity_neg_42_int8_t(
  //   callback(
  //     {
  //       return_type: "int8_t",
  //     },
  //     () => -42
  //   )
  // ).toBe(-42);

  // cb_identity_42_uint16_t(
  //   callback(
  //     {
  //       return_type: "uint16_t",
  //     },
  //     () => 42
  //   )
  // ).toBe(42);

  // cb_identity_42_uint32_t(
  //   callback(
  //     {
  //       return_type: "uint32_t",
  //     },
  //     () => 42
  //   )
  // ).toBe(42);

  // cb_identity_neg_42_int16_t(
  //   callback(
  //     {
  //       return_type: "int16_t",
  //     },
  //     () => -42
  //   )
  // ).toBe(-42);

  // cb_identity_neg_42_int32_t(
  //   callback(
  //     {
  //       return_type: "int32_t",
  //     },
  //     () => -42
  //   )
  // ).toBe(-42);

  close();
});
