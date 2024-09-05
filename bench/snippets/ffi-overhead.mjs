import { dlopen } from "bun:ffi";
import { bench, group, run } from "./runner.mjs";

const types = {
  returns_true: {
    returns: "bool",
    args: [],
  },
  returns_false: {
    returns: "bool",
    args: [],
  },
  returns_42_char: {
    returns: "char",
    args: [],
  },
  returns_42_float: {
    returns: "float",
    args: [],
  },
  returns_42_double: {
    returns: "double",
    args: [],
  },
  returns_42_uint8_t: {
    returns: "uint8_t",
    args: [],
  },
  returns_neg_42_int8_t: {
    returns: "int8_t",
    args: [],
  },
  returns_42_uint16_t: {
    returns: "uint16_t",
    args: [],
  },
  returns_42_uint32_t: {
    returns: "uint32_t",
    args: [],
  },
  // // returns_42_uint64_t: {
  // //   returns: "uint64_t",
  // //   args: [],
  // // },
  returns_neg_42_int16_t: {
    returns: "int16_t",
    args: [],
  },
  returns_neg_42_int32_t: {
    returns: "int32_t",
    args: [],
  },
  // returns_neg_42_int64_t: {
  //   returns: "int64_t",
  //   args: [],
  // },

  identity_char: {
    returns: "char",
    args: ["char"],
  },
  identity_float: {
    returns: "float",
    args: ["float"],
  },
  identity_bool: {
    returns: "bool",
    args: ["bool"],
  },
  identity_double: {
    returns: "double",
    args: ["double"],
  },
  identity_int8_t: {
    returns: "int8_t",
    args: ["int8_t"],
  },
  identity_int16_t: {
    returns: "int16_t",
    args: ["int16_t"],
  },
  identity_int32_t: {
    returns: "int32_t",
    args: ["int32_t"],
  },
  // identity_int64_t: {
  //   returns: "int64_t",
  //   args: ["int64_t"],
  // },
  identity_uint8_t: {
    returns: "uint8_t",
    args: ["uint8_t"],
  },
  identity_uint16_t: {
    returns: "uint16_t",
    args: ["uint16_t"],
  },
  identity_uint32_t: {
    returns: "uint32_t",
    args: ["uint32_t"],
  },
  // identity_uint64_t: {
  //   returns: "uint64_t",
  //   args: ["uint64_t"],
  // },

  add_char: {
    returns: "char",
    args: ["char", "char"],
  },
  add_float: {
    returns: "float",
    args: ["float", "float"],
  },
  add_double: {
    returns: "double",
    args: ["double", "double"],
  },
  add_int8_t: {
    returns: "int8_t",
    args: ["int8_t", "int8_t"],
  },
  add_int16_t: {
    returns: "int16_t",
    args: ["int16_t", "int16_t"],
  },
  add_int32_t: {
    returns: "int32_t",
    args: ["int32_t", "int32_t"],
  },
  // add_int64_t: {
  //   returns: "int64_t",
  //   args: ["int64_t", "int64_t"],
  // },
  add_uint8_t: {
    returns: "uint8_t",
    args: ["uint8_t", "uint8_t"],
  },
  add_uint16_t: {
    returns: "uint16_t",
    args: ["uint16_t", "uint16_t"],
  },
  add_uint32_t: {
    returns: "uint32_t",
    args: ["uint32_t", "uint32_t"],
  },

  does_pointer_equal_42_as_int32_t: {
    returns: "bool",
    args: ["ptr"],
  },

  ptr_should_point_to_42_as_int32_t: {
    returns: "ptr",
    args: [],
  },
  identity_ptr: {
    returns: "ptr",
    args: ["ptr"],
  },
  // add_uint64_t: {
  //   returns: "uint64_t",
  //   args: ["uint64_t", "uint64_t"],
  // },

  cb_identity_true: {
    returns: "bool",
    args: ["ptr"],
  },
  cb_identity_false: {
    returns: "bool",
    args: ["ptr"],
  },
  cb_identity_42_char: {
    returns: "char",
    args: ["ptr"],
  },
  // cb_identity_42_float: {
  // returns: "float",
  // args: ["ptr"],
  // },
  // cb_identity_42_double: {
  // returns: "double",
  // args: ["ptr"],
  // },
  cb_identity_42_uint8_t: {
    returns: "uint8_t",
    args: ["ptr"],
  },
  cb_identity_neg_42_int8_t: {
    returns: "int8_t",
    args: ["ptr"],
  },
  cb_identity_42_uint16_t: {
    returns: "uint16_t",
    args: ["ptr"],
  },
  cb_identity_42_uint32_t: {
    returns: "uint32_t",
    args: ["ptr"],
  },
  // cb_identity_42_uint64_t: {
  // returns: "uint64_t",
  // args: ["ptr"],
  // },
  cb_identity_neg_42_int16_t: {
    returns: "int16_t",
    args: ["ptr"],
  },
  cb_identity_neg_42_int32_t: {
    returns: "int32_t",
    args: ["ptr"],
  },
  // cb_identity_neg_42_int64_t: {
  // returns: "int64_t",
  // args: ["ptr"],
  // },

  return_a_function_ptr_to_function_that_returns_true: {
    returns: "ptr",
    args: [],
  },
};

var opened;
try {
  opened = dlopen("/tmp/bun-ffi-test.dylib", types);
} catch (e) {
  throw new Error("Please run `make compile-ffi-test` to compile the ffi test library");
}

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
} = opened;

group("add_int16_t", () => {
  bench("add_int16_t (raw)", () => raw_add_int16_t(1, 1));
  bench("add_int16_t", () => add_int16_t(1, 1));
});

group("add_char", () => {
  bench("add_char (raw)", () => raw_add_char(1, 1));
  bench("add_char", () => add_char(1, 1));
});
group("add_int16_t", () => {
  bench("add_int16_t (raw)", () => raw_add_int16_t(1, 1));
  bench("add_int16_t", () => add_int16_t(1, 1));
});
group("add_int32_t", () => {
  bench("add_int32_t (raw)", () => raw_add_int32_t(1, 1));
  bench("add_int32_t", () => add_int32_t(1, 1));
});
group("add_int8_t", () => {
  bench("add_int8_t (raw)", () => raw_add_int8_t(1, 1));
  bench("add_int8_t", () => add_int8_t(1, 1));
});
group("add_uint16_t", () => {
  bench("add_uint16_t (raw)", () => raw_add_uint16_t(1, 1));
  bench("add_uint16_t", () => add_uint16_t(1, 1));
});
group("add_uint32_t", () => {
  bench("add_uint32_t (raw)", () => raw_add_uint32_t(1, 1));
  bench("add_uint32_t", () => add_uint32_t(1, 1));
});
group("add_uint8_t", () => {
  bench("add_uint8_t (raw)", () => raw_add_uint8_t(1, 1));
  bench("add_uint8_t", () => add_uint8_t(1, 1));
});
group("identity_bool", () => {
  bench("identity_bool (raw)", () => raw_identity_bool(false));
  bench("identity_bool", () => identity_bool(true));
});
group("identity_char", () => {
  bench("identity_char (raw)", () => raw_identity_char(10));
  bench("identity_char", () => identity_char(10));
});
group("identity_int16_t", () => {
  bench("identity_int16_t (raw)", () => raw_identity_int16_t(10));
  bench("identity_int16_t", () => identity_int16_t(10));
});
group("identity_int32_t", () => {
  bench("identity_int32_t (raw)", () => raw_identity_int32_t(10));
  bench("identity_int32_t", () => identity_int32_t(10));
});
group("identity_int8_t", () => {
  bench("identity_int8_t (raw)", () => raw_identity_int8_t(10));
  bench("identity_int8_t", () => identity_int8_t(10));
});
group("identity_uint16_t", () => {
  bench("identity_uint16_t (raw)", () => raw_identity_uint16_t(10));
  bench("identity_uint16_t", () => identity_uint16_t(10));
});
group("identity_uint32_t", () => {
  bench("identity_uint32_t (raw)", () => raw_identity_uint32_t(10));
  bench("identity_uint32_t", () => identity_uint32_t(10));
});
group("identity_uint8_t", () => {
  bench("identity_uint8_t (raw)", () => raw_identity_uint8_t(10));
  bench("identity_uint8_t", () => identity_uint8_t(10));
});
group("returns_42_char", () => {
  bench("returns_42_char (raw)", () => raw_returns_42_char());
  bench("returns_42_char", () => returns_42_char());
});
group("returns_42_uint16_t", () => {
  bench("returns_42_uint16_t (raw)", () => raw_returns_42_uint16_t());
  bench("returns_42_uint16_t", () => returns_42_uint16_t());
});
group("returns_42_uint32_t", () => {
  bench("returns_42_uint32_t (raw)", () => raw_returns_42_uint32_t());
  bench("returns_42_uint32_t", () => returns_42_uint32_t());
});
group("returns_42_uint8_t", () => {
  bench("returns_42_uint8_t (raw)", () => raw_returns_42_uint8_t());
  bench("returns_42_uint8_t", () => returns_42_uint8_t());
});
group("returns_false", () => {
  bench("returns_false (raw)", () => raw_returns_false());
  bench("returns_false", () => returns_false());
});
group("returns_neg_42_int16_t", () => {
  bench("returns_neg_42_int16_t (raw)", () => raw_returns_neg_42_int16_t());
  bench("returns_neg_42_int16_t", () => returns_neg_42_int16_t());
});
group("returns_neg_42_int32_t", () => {
  bench("returns_neg_42_int32_t (raw)", () => raw_returns_neg_42_int32_t());
  bench("returns_neg_42_int32_t", () => returns_neg_42_int32_t());
});
group("returns_neg_42_int8_t", () => {
  bench("returns_neg_42_int8_t (raw)", () => raw_returns_neg_42_int8_t());
  bench("returns_neg_42_int8_t", () => returns_neg_42_int8_t());
});
group("returns_true", () => {
  bench("returns_true (raw)", () => raw_returns_true());
  bench("returns_true", () => returns_true());
});

group("return_a_function_ptr_to_function_that_returns_true", () => {
  bench("return_a_function_ptr_to_function_that_returns_true (raw)", () =>
    raw_return_a_function_ptr_to_function_that_returns_true(),
  );
  bench("return_a_function_ptr_to_function_that_returns_true", () =>
    return_a_function_ptr_to_function_that_returns_true(),
  );
});
group("returns_42_float", () => {
  bench("returns_42_float (raw)", () => raw_returns_42_float());
  bench("returns_42_float", () => returns_42_float());
});
group("returns_42_double", () => {
  bench("returns_42_double (raw)", () => raw_returns_42_double(42));
  bench("returns_42_double", () => returns_42_double());
});
group("identity_float", () => {
  bench("identity_float (raw)", () => raw_identity_float(42.42));
  bench("identity_float", () => identity_float());
});
group("identity_double", () => {
  bench("identity_double (raw)", () => raw_identity_double(42.42));
  bench("identity_double", () => identity_double());
});

var raw_return_a_function_ptr_to_function_that_returns_true =
  return_a_function_ptr_to_function_that_returns_true.native ?? return_a_function_ptr_to_function_that_returns_true;
var raw_returns_42_float = returns_42_float.native ?? returns_42_float;
var raw_returns_42_double = returns_42_double.native ?? returns_42_double;
var raw_identity_float = identity_float.native ?? identity_float;
var raw_identity_double = identity_double.native ?? identity_double;
var raw_returns_true = returns_true.native ?? returns_true;
var raw_returns_false = returns_false.native ?? returns_false;
var raw_returns_42_char = returns_42_char.native ?? returns_42_char;
var raw_returns_42_uint8_t = returns_42_uint8_t.native ?? returns_42_uint8_t;
var raw_returns_neg_42_int8_t = returns_neg_42_int8_t.native ?? returns_neg_42_int8_t;
var raw_returns_42_uint16_t = returns_42_uint16_t.native ?? returns_42_uint16_t;
var raw_returns_42_uint32_t = returns_42_uint32_t.native ?? returns_42_uint32_t;
var raw_returns_neg_42_int16_t = returns_neg_42_int16_t.native ?? returns_neg_42_int16_t;
var raw_returns_neg_42_int32_t = returns_neg_42_int32_t.native ?? returns_neg_42_int32_t;
var raw_identity_char = identity_char.native ?? identity_char;
var raw_identity_bool = identity_bool.native ?? identity_bool;
var raw_identity_bool = identity_bool.native ?? identity_bool;
var raw_identity_int8_t = identity_int8_t.native ?? identity_int8_t;
var raw_identity_int16_t = identity_int16_t.native ?? identity_int16_t;
var raw_identity_int32_t = identity_int32_t.native ?? identity_int32_t;
var raw_identity_uint8_t = identity_uint8_t.native ?? identity_uint8_t;
var raw_identity_uint16_t = identity_uint16_t.native ?? identity_uint16_t;
var raw_identity_uint32_t = identity_uint32_t.native ?? identity_uint32_t;
var raw_add_char = add_char.native ?? add_char;
var raw_add_int8_t = add_int8_t.native ?? add_int8_t;
var raw_add_int16_t = add_int16_t.native ?? add_int16_t;
var raw_add_int32_t = add_int32_t.native ?? add_int32_t;
var raw_add_uint8_t = add_uint8_t.native ?? add_uint8_t;
var raw_add_uint16_t = add_uint16_t.native ?? add_uint16_t;
var raw_add_uint32_t = add_uint32_t.native ?? add_uint32_t;

run({ collect: false, percentiles: true });
