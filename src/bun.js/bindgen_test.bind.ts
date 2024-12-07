import { t, fn } from "bindgen";

fn({
  name: "add",
  args: {
    global: t.globalObject,
    a: t.i32,
    b: t.i32.default(-1),
  },
  ret: t.i32,
});

fn({
  name: "requiredAndOptionalArg",
  args: {
    a: t.boolean,
    b: t.usize.optional,
    c: t.i32.enforceRange(0, 100).default(42),
    d: t.u8.optional,
  },
  ret: t.i32,
});
