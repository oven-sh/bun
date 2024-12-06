import { t, fn } from "bindgen";

fn({
  name: "requiredAndOptionalArg",
  args: {
    a: t.boolean,
    b: t.usize,
    c: t.i32.default(42),
    d: t.u8.optional,
  },
  ret: t.i32,
});
