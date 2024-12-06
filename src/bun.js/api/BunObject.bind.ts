import { t, fn } from "bindgen";

export const BracesOptions = t.dictionary({
  tokenize: t.boolean.default(false),
  parse: t.boolean.default(false),
});

fn({
  name: "braces",
  args: {
    global: t.globalObject,
    input: t.DOMString,
    options: BracesOptions.default({}),
  },
  ret: t.any,
});

fn({
  name: "gc",
  args: {
    vm: t.zigVirtualMachine,
    force: t.boolean.default(false),
  },
  ret: t.usize,
});

export const StringWidthOptions = t.dictionary({
  countAnsiEscapeCodes: t.boolean.default(false),
  ambiguousIsNarrow: t.boolean.default(false),
});

fn({
  name: "stringWidth",
  args: {
    str: t.DOMString.default(""),
    opts: StringWidthOptions.default({}),
  },
  ret: t.usize,
});

fn({
  name: "add",
  args: {
    global: t.globalObject,
    a: t.usize.enforceRange(32, 64),
    b: t.usize.default(1),
  },
  ret: t.usize,
});
