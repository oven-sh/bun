import * as b from "../../codegen/bindgen-lib.ts";

/** Chainable mutators — record an op and return `this`. */
const chainable = { returns: b.self, passThis: true } as const;
const chainableWithOptions = { ...chainable, args: { options: b.any }, capability: "js", throws: true } as const;
/** Terminal async ops — run decode → pipeline → encode on the work pool. */
const terminal = { returns: b.any, capability: "js", throws: true, passThis: true } as const;

export const Image = b.class({
  rustPath: "crate::image::Image",
  estimatedSize: true,
  construct: {
    passStructure: true,
    args: { input: b.any, options: b.any },
    capability: "js",
    throws: true,
    length: 0,
  },
  /** Keeps the input ArrayBuffer/TypedArray alive: its bytes are borrowed, not copied. */
  internalFields: ["sourceJS"],
  proto: {
    avif: chainableWithOptions,
    blob: terminal,
    buffer: terminal,
    bytes: terminal,
    /** toBase64() with the `data:{mime};base64,` prefix. */
    dataurl: terminal,
    flip: chainable,
    flop: chainable,
    heic: chainableWithOptions,
    /** Read-only after a pipeline has run; -1 before. */
    height: { getter: b.i32 },
    jpeg: chainableWithOptions,
    metadata: terminal,
    modulate: chainableWithOptions,
    /** ThumbHash rendered as a PNG data: URL of at most 32px. */
    placeholder: { ...terminal, args: { format: b.any }, length: 0 },
    png: chainableWithOptions,
    resize: {
      ...chainable,
      args: { width: b.any, height: b.any, options: b.any },
      capability: "js",
      throws: true,
      length: 2,
    },
    rotate: { ...chainable, args: { degrees: b.any }, capability: "js", throws: true },
    toBase64: terminal,
    /** Sharp-compat alias for `buffer()`; same native fn, no overhead. */
    toBuffer: { ...terminal, rustName: "buffer" },
    webp: chainableWithOptions,
    width: { getter: b.i32 },
    /** Encode → fs.writeFile, both off-thread; resolves bytes-written. */
    write: { ...terminal, args: { dest: b.any } },
  },
  static: {
    /** Process-global: "system" (CoreGraphics/WIC) or "bun" (static codecs). A task reads it when it launches. */
    backend: { getter: b.any, setter: true, capability: "js", throws: true },
    clipboardChangeCount: { returns: b.f64 },
    /** null on Linux (no native API) and when the clipboard has no image. */
    fromClipboard: { returns: b.self.nullable, capability: "js", throws: true },
    hasClipboardImage: { returns: b.bool },
  },
});
