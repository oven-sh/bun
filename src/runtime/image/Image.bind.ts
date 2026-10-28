import * as b from "../../codegen/bindgen-lib.ts";

/** Chainable mutators — record an op and return `this`. */
const chainable = { returns: b.self, passThis: true } as const;
/** Terminal async ops — run decode → pipeline → encode on the work pool. */
const terminal = { returns: b.promise, capability: "js", throws: true, passThis: true } as const;

export const ImageEncodeOptions = b.dictionary(
  {
    quality: b.f64.otherAsNull,
    lossless: b.bool.loose.optional,
    compressionLevel: b.f64.otherAsNull,
    palette: b.bool.loose.optional,
    colors: b.f64.otherAsNull,
    dither: b.bool.loose.optional,
    progressive: b.bool.loose.optional,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);
/** The options set so far are read before the getters of `options` run. */
const chainableWithOptions = {
  ...chainable,
  args: { options: ImageEncodeOptions.deferred },
  capability: "js",
  throws: true,
} as const;

export const ImageModulateOptions = b.dictionary(
  { brightness: b.f64.otherAsNull, saturation: b.f64.otherAsNull },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const ImageOptions = b.dictionary(
  { maxPixels: b.f64.otherAsNull, autoOrient: b.bool.loose.optional },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const Image = b.class({
  rustPath: "crate::image::Image",
  estimatedSize: true,
  construct: {
    passStructure: true,
    /** What is wrong with `input` is reported before the getters of `options` run. */
    args: { input: b.opaque, options: ImageOptions.deferred },
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
    height: { getter: b.i32, pure: true },
    jpeg: chainableWithOptions,
    metadata: terminal,
    modulate: { ...chainable, args: { options: ImageModulateOptions.deferred }, capability: "js", throws: true },
    /** ThumbHash rendered as a PNG data: URL of at most 32px. */
    placeholder: { ...terminal, args: { format: b.string.loose.nullable }, length: 0 },
    png: chainableWithOptions,
    resize: {
      ...chainable,
      args: { width: b.f64, height: b.f64.otherAsNull, options: b.opaque },
      expected: { width: "resize(width, height?, options?)" },
      capability: "js",
      throws: true,
      length: 2,
    },
    rotate: {
      ...chainable,
      args: { degrees: b.f64 },
      expected: { degrees: "rotate(degrees) expects 90, 180 or 270" },
      capability: "js",
      throws: true,
    },
    toBase64: terminal,
    /** Sharp-compat alias for `buffer()`; same native fn, no overhead. */
    toBuffer: { ...terminal, rustName: "buffer" },
    webp: chainableWithOptions,
    width: { getter: b.i32, pure: true },
    /** Encode → fs.writeFile, both off-thread; resolves bytes-written. */
    write: { ...terminal, args: { dest: b.opaque } },
  },
  static: {
    /** Process-global: "system" (CoreGraphics/WIC) or "bun" (static codecs). A task reads it when it launches. */
    backend: { getter: b.opaque.returning("string"), setter: true, capability: "js", throws: true },
    clipboardChangeCount: { returns: b.f64 },
    /** null on Linux (no native API) and when the clipboard has no image. */
    fromClipboard: { returns: b.self.nullable, capability: "js", throws: true },
    hasClipboardImage: { returns: b.bool },
  },
});
