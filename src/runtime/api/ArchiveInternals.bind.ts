import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::archive::testing" });

export const ReadTarSkip = b.enumeration(["none", "all", "odd", "otherThanFiles"]);

export const ReadTarOptions = b.dictionary({
  /** The rules of npm's own tar reader, as for a package. */
  npm: b.bool.default(false),
  /** What differs on these systems is an option of the reader, so every system can test it. */
  windows: b.bool.default(false),
  macos: b.bool.default(false),
  /** Read like `bun install` reads a download: nothing is detected but gzip, by its first two bytes. */
  stream: b.bool.default(false),
  /** With `stream`, how much of the input arrives at a time. 0 is all of it. */
  pieceSize: b.usize.default(0),
  /** With `stream`, the reader learns that the input has ended only after it has taken the last piece. */
  lateEnd: b.bool.default(false),
  /** The entries whose contents are not read. */
  skip: ReadTarSkip.default("none"),
});

/** Everything the tar reader reports about `data`, one line each. */
export const readTar = b.fn({
  args: { data: b.bytes({ from: ["buffer"] }), options: ReadTarOptions.default({}) },
  returns: b.string.utf8,
});

export const WriteTarFile = b.dictionary({
  /** What the header announces. */
  size: b.f64,
  /** How much of `contents` is written for it, which may be less or more. */
  given: b.usize,
  perm: b.u32,
  mtime: b.f64,
});

export const WriteTarOptions = b.dictionary({
  /** Names are recorded the way Windows does. */
  windows: b.bool.default(false),
  /** As `bun pm pack` writes: compressed, and not padded to a full record. */
  gzipLevel: b.u8.optional,
  /** How much of a file's contents is written at a time. */
  writeSize: b.usize.default(8192),
  /** Without it the result ends where the last write did, so that a size can be announced and not written. */
  finish: b.bool.default(true),
});

/** `names` has a NUL behind each name, and `contents` is what the files hold, one after the other. */
export const writeTar = b.fn({
  args: {
    files: b.array(WriteTarFile),
    names: b.bytes({ from: ["buffer"] }),
    contents: b.bytes({ from: ["buffer"] }),
    options: WriteTarOptions.default({}),
  },
  returns: b.bufferSource,
  capability: "heap",
  throws: true,
});
