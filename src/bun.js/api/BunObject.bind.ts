import { t, Fn } from "bindgen";

const className = "Bun";

export const BracesOptions = t.dictionary({
  tokenize: t.boolean.default(false),
  parse: t.boolean.default(false),
});

export const braces = Fn({
  className: "Bun.$",
  args: {
    global: t.globalObject,
    input: t.BunString,
    options: BracesOptions.default({}),
  },
  ret: t.any,
});

export const gc = Fn({
  className,
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

export const stringWidth = Fn({
  className,
  args: {
    str: t.DOMString.default(""),
    opts: StringWidthOptions.default({}),
  },
  ret: t.usize,
});
