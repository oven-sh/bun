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
const js = { capability: "js", throws: true } as const;
const format = { ...chainable, args: { options: ImageEncodeOptions.deferred }, ...js } as const;

export const ImageModulateOptions = b.dictionary(
  { brightness: b.f64.otherAsNull, saturation: b.f64.otherAsNull },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const ImageInput = b.union({
  missing: b.null,
  path: b.string.allowStringObject,
  buffer: b.bufferSource.allowShared,
  blob: b.wrapped("Bun::Bindgen::Generated::JSBlob", "GeneratedBlob.h", { rustPath: "bun_jsc::webcore_types::Blob" }),
  buildArtifact: b.wrapped("Bun::Bindgen::Generated::JSBuildArtifact", "GeneratedJSBundler.h", {
    rustPath: "crate::api::js_bundler::BuildArtifact",
    tsType: "Bun.BuildArtifact",
  }),
  other: b.ignored,
});
export const ImageOptions = b.dictionary(
  { maxPixels: b.f64.otherAsNull, autoOrient: b.bool.loose.optional },
  { allowArray: true, nonObjectAsEmpty: true },
);

/** An unknown `filter` is reported before `fit` is read, and an unknown `fit` before `withoutEnlargement`. */
export const ImageResizeOptions = b.dictionary(
  {
    filter: { type: b.string.allowStringObject.nullable, expected: "filter must be a string" },
    fit: { type: b.string.allowStringObject.nullable, expected: "fit must be a string" },
    withoutEnlargement: b.bool.loose.optional,
  },
  { deferred: true },
);

/** The extension of a path picks the format. */
export const destinationPath = b.conversion(b.string.allowStringObject.otherAsNull);

export const Image = b.class({
  rustPath: "crate::image::Image",
  estimatedSize: true,
  construct: {
    passStructure: true,
    /** What is wrong with `input` is reported before the getters of `options` run. */
    args: { input: ImageInput.withValue, options: ImageOptions.deferred },
    capability: "js",
    throws: true,
    length: 0,
  },
  /** Keeps the input ArrayBuffer/TypedArray alive: its bytes are borrowed, not copied. */
  internalFields: ["sourceJS"],
  proto: {
    avif: format,
    blob: terminal,
    buffer: terminal,
    bytes: terminal,
    /** toBase64() with the `data:{mime};base64,` prefix. */
    dataurl: terminal,
    flip: chainable,
    flop: chainable,
    heic: format,
    /** Read-only after a pipeline has run; -1 before. */
    height: { getter: b.i32 },
    jpeg: format,
    metadata: terminal,
    modulate: { ...chainable, args: { options: ImageModulateOptions.deferred }, ...js },
    /** ThumbHash rendered as a PNG data: URL of at most 32px. */
    placeholder: { ...terminal, args: { format: b.string.loose.nullable }, length: 0 },
    png: format,
    resize: {
      ...chainable,
      args: { width: b.f64, height: b.f64.otherAsNull, options: ImageResizeOptions.otherAsNull },
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
    webp: format,
    width: { getter: b.i32 },
    /** Encode → fs.writeFile, both off-thread; resolves bytes-written. What is wrong with `dest` rejects after the encode. */
    write: { ...terminal, args: { dest: b.opaque.nullable }, length: 1 },
  },
  static: {
    /** Process-global: "system" (CoreGraphics/WIC) or "bun" (static codecs). A task reads it when it launches. */
    backend: {
      getter: b.string.local,
      setter: { type: b.string.allowStringObject.otherAsNull },
      capability: "js",
      throws: true,
    },
    clipboardChangeCount: { returns: b.f64 },
    /** null on Linux (no native API) and when the clipboard has no image. */
    fromClipboard: { returns: b.self.nullable, capability: "js", throws: true },
    hasClipboardImage: { returns: b.bool },
  },
});
