import { t, fn } from "bindgen";

export const add = fn({
  args: {
    global: t.globalObject,
    a: t.i32,
    b: t.i32.default(-1),
  },
  ret: t.i32,
});

export const requiredAndOptionalArg = fn({
  args: {
    a: t.boolean,
    b: t.usize.optional,
    c: t.i32.enforceRange(0, 100).default(42),
    d: t.u8.optional,
  },
  ret: t.i32,
});

// export const HeadersInit = t.oneOf(t.sequence(t.sequence(t.ByteString)), t.record(t.ByteString));
export const HeadersInit = t.sequence(t.DOMString);

export const headersInit = fn({
  args: {
    a: HeadersInit,
  },
  ret: t.i32,
});
