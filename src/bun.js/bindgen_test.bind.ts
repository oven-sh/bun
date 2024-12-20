import { t, Fn } from "bindgen";

export const add = Fn({
  args: {
    global: t.globalObject,
    a: t.i32,
    b: t.i32.default(-1),
  },
  ret: t.i32,
});

export const requiredAndOptionalArg = Fn({
  args: {
    a: t.boolean,
    b: t.usize.optional,
    c: t.i32.enforceRange(0, 100).default(42),
    d: t.u8.optional,
  },
  ret: t.i32,
});

export const customDeserializer = Fn({
  args: {
    a: t.StringOrBuffer,
    b: t.ArrayBuffer,
    c: t.zigEnum("bindgen_test.zig", "SampleEnum"),
    d: t.StringOrBuffer.optional,
    e: t.ArrayBuffer.optional,
  },
  ret: t.i32,
});

export const returnBunString = Fn({
  args: {
    len: t.u32.enforceRange(),
  },
  ret: t.BunString,
});

// export const HeadersInit = t.sequence(t.DOMString);

// export const headersInit = fn({
//   args: {
//     a: HeadersInit,
//   },
//   ret: t.i32,
// });
