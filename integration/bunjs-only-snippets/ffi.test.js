import { describe, it, expect } from "bun:test";
import { unsafe } from "bun";
//
import {
  viewSource,
  dlopen,
  CString,
  ptr,
  toBuffer,
  toArrayBuffer,
  FFIType,
} from "bun:ffi";

it("ffi print", () => {
  viewSource({
    add: {
      args: [FFIType.int],
      return_type: "int32_t",
    },
  })[0];
});

it("ffi run", () => {
  const types = {
    returns_true: {
      return_type: "bool",
      params: [],
    },
    returns_false: {
      return_type: "bool",
      params: [],
    },
    returns_42_char: {
      return_type: "char",
      params: [],
    },
    // returns_42_float: {
    //   return_type: "float",
    //   params: [],
    // },
    // returns_42_double: {
    //   return_type: "double",
    //   params: [],
    // },
    returns_42_uint8_t: {
      return_type: "uint8_t",
      params: [],
    },
    returns_neg_42_int8_t: {
      return_type: "int8_t",
      params: [],
    },
    returns_42_uint16_t: {
      return_type: "uint16_t",
      params: [],
    },
    returns_42_uint32_t: {
      return_type: "uint32_t",
      params: [],
    },
    // // returns_42_uint64_t: {
    // //   return_type: "uint64_t",
    // //   params: [],
    // // },
    returns_neg_42_int16_t: {
      return_type: "int16_t",
      params: [],
    },
    returns_neg_42_int32_t: {
      return_type: "int32_t",
      params: [],
    },
    // returns_neg_42_int64_t: {
    //   return_type: "int64_t",
    //   params: [],
    // },

    identity_char: {
      return_type: "char",
      params: ["char"],
    },
    // identity_float: {
    //   return_type: "float",
    //   params: ["float"],
    // },
    identity_bool: {
      return_type: "bool",
      params: ["bool"],
    },
    // identity_double: {
    //   return_type: "double",
    //   params: ["double"],
    // },
    identity_int8_t: {
      return_type: "int8_t",
      params: ["int8_t"],
    },
    identity_int16_t: {
      return_type: "int16_t",
      params: ["int16_t"],
    },
    identity_int32_t: {
      return_type: "int32_t",
      params: ["int32_t"],
    },
    // identity_int64_t: {
    //   return_type: "int64_t",
    //   params: ["int64_t"],
    // },
    identity_uint8_t: {
      return_type: "uint8_t",
      params: ["uint8_t"],
    },
    identity_uint16_t: {
      return_type: "uint16_t",
      params: ["uint16_t"],
    },
    identity_uint32_t: {
      return_type: "uint32_t",
      params: ["uint32_t"],
    },
    // identity_uint64_t: {
    //   return_type: "uint64_t",
    //   params: ["uint64_t"],
    // },

    add_char: {
      return_type: "char",
      params: ["char", "char"],
    },
    add_float: {
      return_type: "float",
      params: ["float", "float"],
    },
    add_double: {
      return_type: "double",
      params: ["double", "double"],
    },
    add_int8_t: {
      return_type: "int8_t",
      params: ["int8_t", "int8_t"],
    },
    add_int16_t: {
      return_type: "int16_t",
      params: ["int16_t", "int16_t"],
    },
    add_int32_t: {
      return_type: "int32_t",
      params: ["int32_t", "int32_t"],
    },
    // add_int64_t: {
    //   return_type: "int64_t",
    //   params: ["int64_t", "int64_t"],
    // },
    add_uint8_t: {
      return_type: "uint8_t",
      params: ["uint8_t", "uint8_t"],
    },
    add_uint16_t: {
      return_type: "uint16_t",
      params: ["uint16_t", "uint16_t"],
    },
    add_uint32_t: {
      return_type: "uint32_t",
      params: ["uint32_t", "uint32_t"],
    },

    does_pointer_equal_42_as_int32_t: {
      return_type: "bool",
      params: ["ptr"],
    },

    ptr_should_point_to_42_as_int32_t: {
      return_type: "ptr",
      params: [],
    },
    // add_uint64_t: {
    //   return_type: "uint64_t",
    //   params: ["uint64_t", "uint64_t"],
    // },
  };
  const {
    symbols: {
      returns_true,
      returns_false,
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
      add_uint32_t,
      add_uint64_t,
      does_pointer_equal_42_as_int32_t,
      ptr_should_point_to_42_as_int32_t,
    },
    close,
  } = dlopen("/tmp/bun-ffi-test.dylib", types);

  expect(returns_true()).toBe(true);
  expect(returns_false()).toBe(false);
  expect(returns_42_char()).toBe(42);
  //   expect(returns_42_float()).toBe(42);
  //   expect(returns_42_double()).toBe(42);
  expect(returns_42_uint8_t()).toBe(42);
  expect(returns_neg_42_int8_t()).toBe(-42);
  expect(returns_42_uint16_t()).toBe(42);
  expect(returns_42_uint32_t()).toBe(42);
  //   expect(returns_42_uint64_t()).toBe(42);
  expect(returns_neg_42_int16_t()).toBe(-42);
  expect(returns_neg_42_int32_t()).toBe(-42);
  //   expect(returns_neg_42_int64_t()).toBe(-42);
  expect(identity_char(10)).toBe(10);
  //   expect(identity_float(10.1)).toBe(10.1);
  expect(identity_bool(true)).toBe(true);
  expect(identity_bool(false)).toBe(false);
  //   expect(identity_double(10.1)).toBe(10.1);
  expect(identity_int8_t(10)).toBe(10);
  expect(identity_int16_t(10)).toBe(10);
  expect(identity_int32_t(10)).toBe(10);
  //   expect(identity_int64_t(10)).toBe(10);
  expect(identity_uint8_t(10)).toBe(10);
  expect(identity_uint16_t(10)).toBe(10);
  expect(identity_uint32_t(10)).toBe(10);
  expect(add_char(1, 1)).toBe(2);
  //   expect(add_float(1.1, 1.1)).toBe(2.2);
  //   expect(add_double(1.1, 1.1)).toBe(2.2);
  expect(add_int8_t(1, 1)).toBe(2);
  expect(add_int16_t(1, 1)).toBe(2);
  expect(add_int32_t(1, 1)).toBe(2);
  //   expect(add_int64_t(1, 1)).toBe(2);
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
  expect(new CString(cptr, 0, 1)).toBe("*");
  close();
});
``;
