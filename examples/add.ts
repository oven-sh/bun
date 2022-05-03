import { dlopen, suffix } from "bun:ffi";

const {
  symbols: { add },
} = dlopen(`./libadd.${suffix}`, {
  add: {
    args: ["i32", "i32"],
    returns: "i32",
  },
});

console.log(add(1, 2));
