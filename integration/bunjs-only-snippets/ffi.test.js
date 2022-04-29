import { describe, it, expect } from "bun:test";

it("ffi print", () => {
  Bun.dlprint({
    add: {
      params: ["int32_t", "int32_t"],
      return_type: "int32_t",
    },
  })[0];
});

it("ffi run", () => {
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
    },
    close,
  } = Bun.dlopen("/tmp/bun-ffi-test.dylib", {
    returns_true: {
      returns: "bool",
      expects: [],
    },
    returns_false: {
      returns: "bool",
      expects: [],
    },
    returns_42_char: {
      returns: "char",
      expects: [],
    },
    returns_42_float: {
      returns: "float",
      expects: [],
    },
    returns_42_double: {
      returns: "double",
      expects: [],
    },
    returns_42_uint8_t: {
      returns: "uint8_t",
      expects: [],
    },
    returns_neg_42_int8_t: {
      returns: "int8_t",
      expects: [],
    },
    returns_42_uint16_t: {
      returns: "uint16_t",
      expects: [],
    },
    returns_42_uint32_t: {
      returns: "uint32_t",
      expects: [],
    },
    returns_42_uint64_t: {
      returns: "uint64_t",
      expects: [],
    },
    returns_neg_42_int16_t: {
      returns: "int16_t",
      expects: [],
    },
    returns_neg_42_int32_t: {
      returns: "int32_t",
      expects: [],
    },
    returns_neg_42_int64_t: {
      returns: "int64_t",
      expects: [],
    },

    identity_char: {
      returns: "char",
      expects: ["char"],
    },
    identity_float: {
      returns: "float",
      expects: ["float"],
    },
    identity_bool: {
      returns: "bool",
      expects: ["bool"],
    },
    identity_double: {
      returns: "double",
      expects: ["double"],
    },
    identity_int8_t: {
      returns: "int8_t",
      expects: ["int8_t"],
    },
    identity_int16_t: {
      returns: "int16_t",
      expects: ["int16_t"],
    },
    identity_int32_t: {
      returns: "int32_t",
      expects: ["int32_t"],
    },
    identity_int64_t: {
      returns: "int64_t",
      expects: ["int64_t"],
    },
    identity_uint8_t: {
      returns: "uint8_t",
      expects: ["uint8_t"],
    },
    identity_uint16_t: {
      returns: "uint16_t",
      expects: ["uint16_t"],
    },
    identity_uint32_t: {
      returns: "uint32_t",
      expects: ["uint32_t"],
    },
    identity_uint64_t: {
      returns: "uint64_t",
      expects: ["uint64_t"],
    },

    add_char: {
      returns: "char",
      expects: ["char", "char"],
    },
    add_float: {
      returns: "float",
      expects: ["float", "float"],
    },
    add_double: {
      returns: "double",
      expects: ["double", "double"],
    },
    add_int8_t: {
      returns: "int8_t",
      expects: ["int8_t", "int8_t"],
    },
    add_int16_t: {
      returns: "int16_t",
      expects: ["int16_t", "int16_t"],
    },
    add_int32_t: {
      returns: "int32_t",
      expects: ["int32_t", "int32_t"],
    },
    add_int64_t: {
      returns: "int64_t",
      expects: ["int64_t", "int64_t"],
    },
    add_uint8_t: {
      returns: "uint8_t",
      expects: ["uint8_t", "uint8_t"],
    },
    add_uint16_t: {
      returns: "uint16_t",
      expects: ["uint16_t", "uint16_t"],
    },
    add_uint32_t: {
      returns: "uint32_t",
      expects: ["uint32_t", "uint32_t"],
    },
    add_uint64_t: {
      returns: "uint64_t",
      expects: ["uint64_t", "uint64_t"],
    },
  });
  expect(add_char(1, 1)).toBe(2);
  expect(add_float(1.1, 1.1)).toBe(2.2);
  expect(add_double(1.1, 1.1)).toBe(2.2);
  expect(add_int8_t(1, 1)).toBe(2);
  expect(add_int16_t(1, 1)).toBe(2);
  expect(add_int32_t(1, 1)).toBe(2);
  //   expect(add_int64_t(1, 1)).toBe(2);
  expect(add_uint8_t(1, 1)).toBe(2);
  expect(add_uint16_t(1, 1)).toBe(2);
  expect(add_uint32_t(1, 1)).toBe(2);
  //   expect(add_uint64_t(1, 1)).toBe(2);
  close();
});
``;
