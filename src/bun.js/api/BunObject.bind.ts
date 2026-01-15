import { fn, t } from "bindgen";

export const BracesOptions = t.dictionary({
  tokenize: t.boolean.default(false),
  parse: t.boolean.default(false),
});

export const braces = fn({
  args: {
    global: t.globalObject,
    input: t.DOMString,
    options: BracesOptions.default({}),
  },
  ret: t.any,
});

export const gc = fn({
  args: {
    vm: t.zigVirtualMachine,
    force: t.boolean.default(false),
  },
  ret: t.usize,
});

export const StringWidthOptions = t.dictionary({
  countAnsiEscapeCodes: t.boolean.default(false),
  ambiguousIsNarrow: t.boolean.default(true),
});

export const stringWidth = fn({
  args: {
    str: t.DOMString.default(""),
    opts: StringWidthOptions.default({}),
  },
  ret: t.usize,
});
