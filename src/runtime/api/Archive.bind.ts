import * as b from "../../codegen/bindgen-lib.ts";

const method = { returns: b.promise, capability: "js", throws: true } as const;

/** The elements of `list` are read one at a time, each checked before the next is read. */
export const ArchiveGlob = b.union({ pattern: b.string.allowStringObject.utf8.owned, list: b.jsArray });
export const ArchiveExtractOptions = b.dictionary(
  {
    glob: {
      type: ArchiveGlob.emptyStringAsNull,
      expected: "Archive.extract: glob must be a string or array of strings",
    },
  },
  { allowArray: true },
);

/** `object` is a `Blob`, an `Archive`, or the files by their paths. */
export const ArchiveData = b.union({ buffer: b.bufferSource.allowShared, object: b.object, other: b.ignored });
/** `level` is only read with `compress`. */
export const ArchiveOptions = b.dictionary(
  {
    compress: {
      type: b.string.allowStringObject.emptyStringAsNull,
      expected: "Archive: compress option must be a string",
    },
    level: { type: b.f64.emptyStringAsNull, expected: "Archive: level must be a number" },
  },
  { deferred: true },
);

export const Archive = b.class({
  rustPath: "crate::api::archive::Archive",
  construct: {
    args: { data: ArchiveData, options: ArchiveOptions.nullable },
    expected: { options: "Archive: options must be an object" },
    capability: "js",
    throws: true,
    length: 0,
  },
  proto: {
    blob: method,
    bytes: method,
    extract: {
      ...method,
      args: { path: b.string.allowStringObject, options: ArchiveExtractOptions.nullable },
      expected: {
        path: "Archive.extract requires a path argument",
        options: "Archive.extract: second argument must be an options object",
      },
      length: 2,
    },
    files: {
      ...method,
      args: { glob: ArchiveGlob.nullable },
      expected: { glob: "Archive.files: glob must be a string or array of strings" },
      length: 0,
    },
  },
  static: {
    write: {
      ...method,
      args: { path: b.string.allowStringObject, data: ArchiveData, options: ArchiveOptions.nullable },
      expected: {
        path: "Archive.write: first argument must be a string path",
        options: "Archive: options must be an object",
      },
      length: 2,
    },
  },
});
