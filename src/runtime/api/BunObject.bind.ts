import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::bun_object" });

export const allocUnsafe = b.fn({
  args: { size: b.u32 },
  returns: b.bufferSource,
  capability: "heap",
  throws: true,
});

export const BracesOptions = b.dictionary(
  {
    tokenize: b.bool.loose.default(false),
    parse: b.bool.loose.default(false),
  },
  { allowArray: true },
);

export const braces = b.fn({
  args: {
    input: b.string.loose,
    options: BracesOptions.nullable.default({}),
  },
  returns: b.any,
  capability: "js",
  throws: true,
});

export const gc = b.fn({
  args: {
    force: b.bool.loose.default(false),
  },
  returns: b.usize,
  capability: "js",
  rustPath: "crate::api::bun_object::gc_from_js",
});

export const MmapOptions = b.dictionary(
  {
    shared: b.bool.loose.default(true),
    sync: b.bool.loose.default(false),
    size: b.f64.loose.optional,
    offset: b.f64.loose.default(0),
  },
  { allowArray: true },
);

export const mmap = b.fn({
  args: {
    path: b.string.utf8,
    options: MmapOptions.nullable.default({}),
  },
  returns: b.any,
  capability: "js",
  throws: true,
});

export const EditorOptions = b.dictionary(
  {
    editor: b.string.loose.utf8.nullable,
    line: b.string.loose.utf8.nullable,
    column: b.string.loose.utf8.nullable,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const openInEditor = b.fn({
  args: {
    path: b.string.loose.utf8.default(""),
    options: EditorOptions.nullable.default({}),
  },
  capability: "heap",
  throws: true,
});

export const shellEscape = b.fn({
  args: { input: b.string.loose.withValue },
  returns: b.string.utf8,
  capability: "heap",
  throws: true,
});

export const shrink = b.fn({ capability: "js" });

export const sleepSync = b.fn({
  args: { milliseconds: b.f64 },
  capability: "heap",
  throws: true,
});

export const WhichOptions = b.dictionary(
  {
    PATH: b.string.loose.utf8.optional,
    cwd: b.string.loose.utf8.optional,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const which = b.fn({
  args: {
    command: b.string.loose.utf8.nullable,
    options: WhichOptions.nullable.default({}),
  },
  returns: b.string.utf8.nullable,
  capability: "heap",
  throws: true,
});
