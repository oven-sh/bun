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
    symbols: { add },
    close,
  } = Bun.dlopen("/tmp/libffi-test.dylib", {
    add: {
      params: ["int32_t", "int32_t"],
      return_type: "int32_t",
    },
  });
  expect(add(1, 2)).toBe(3);
  close();
});
``;
