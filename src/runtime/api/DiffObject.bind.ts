import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::diff_object" });

/** A whole number from 0 on, or `Infinity`. */
const limit = b.f64;
const maxEditLength = limit.optional;
const context = limit.default(4);

export const Options = b.dictionary({ maxEditLength }, { reportedAs: "options" });
export const HunksOptions = b.dictionary({ context, maxEditLength }, { reportedAs: "options" });
export const PatchOptions = b.dictionary(
  {
    oldFileName: b.string.utf8.optional,
    newFileName: b.string.utf8.optional,
    oldHeader: b.string.optional,
    newHeader: b.string.optional,
    context,
    maxEditLength,
  },
  { reportedAs: "options" },
);

export const Change = b.dictionary({ value: b.string, added: b.bool, removed: b.bool, count: b.usize });
export const Hunk = b.dictionary({
  oldStart: b.usize,
  oldLines: b.usize,
  newStart: b.usize,
  newLines: b.usize,
  lines: b.array(b.string),
});
export const FilePatch = b.dictionary({
  index: b.string.optional,
  oldFileName: b.string.optional,
  oldHeader: b.string.optional,
  newFileName: b.string.optional,
  newHeader: b.string.optional,
  oldMode: b.string.optional,
  newMode: b.string.optional,
  isGit: b.bool.optional,
  isRename: b.bool.optional,
  isCopy: b.bool.optional,
  isCreate: b.bool.optional,
  isDelete: b.bool.optional,
  isBinary: b.bool.optional,
  hunks: b.array(Hunk),
});

export const HunkToApply = b.dictionary({ oldStart: b.u32, lines: b.array(b.string) }, { reportedAs: "hunk" });
export const PatchToApply = b.union({ text: b.string, hunks: b.array(HunkToApply) });

const texts = { oldText: b.string, newText: b.string } as const;
const throws = { capability: "heap", throws: true } as const;
const text = {
  args: { ...texts, options: Options.default({}) },
  returns: b.array(Change).optional,
  ...throws,
} as const;

export const diff = b.namespace({
  lines: text,
  words: text,
  chars: text,
  /** An element can be a getter. */
  arrays: {
    args: { oldArray: b.jsArray, newArray: b.jsArray, options: Options.default({}) },
    returns: b.jsArray.optional,
    capability: "js",
    throws: true,
  },
  hunks: { args: { ...texts, options: HunksOptions.default({}) }, returns: b.array(Hunk).optional, ...throws },
  createPatch: { args: { ...texts, options: PatchOptions.default({}) }, returns: b.string.optional, ...throws },
  parsePatch: { args: { patch: b.string }, returns: b.array(FilePatch), ...throws },
  applyPatch: {
    args: { source: b.string, patch: PatchToApply },
    expected: { patch: "patch must be a string or an array of hunks" },
    returns: b.string.optional,
    ...throws,
  },
});
