import * as b from "../../codegen/bindgen-lib.ts";

// Chainable mutators — record an op and return `this`.
const chainable = { returns: b.self, passThis: true } as const;
const chainableWithOptions = { ...chainable, args: { options: b.any }, capability: "js", throws: true } as const;
// Terminal async ops — run decode → pipeline → encode on the work pool.
const terminal = { returns: b.any, passThis: true, capability: "js", throws: true } as const;

export const Image = b.class({
  rustPath: "crate::image::Image",
  configurable: false,
  construct: {
    passStructure: true,
    args: { input: b.any, options: b.any },
    capability: "js",
    throws: true,
    length: 0,
  },
  // Report owned input (Blob dupe / data:-URL / path string) so a heap of
  // idle Image objects shows up in the GC's accounting. The js_buffer source
  // is the user's ArrayBuffer and already counted via the cached value slot;
  // off-thread RGBA scratch lives only for the task's duration so isn't.
  estimatedSize: true,
  // Strong-ref slot for the input ArrayBuffer/TypedArray so we BORROW its
  // bytes instead of duping in the constructor. While a task is in flight
  // the JSRef on the native side holds a Strong ref to this wrapper, the
  // wrapper's sourceJS slot keeps the ArrayBuffer alive, and the buffer is
  // pinned for the task's duration — so the slice stays valid off-thread.
  // (The JSRef upgrade/downgrade is explicit at schedule/then.)
  internalFields: ["sourceJS"],
  static: {
    // Process-global backend selector: "system" (CoreGraphics/WIC + vImage,
    // default where available) or "bun" (static libjpeg-turbo/spng/libwebp +
    // Highway resize, byte-identical across platforms). Set BEFORE awaiting a
    // pipeline; in-flight tasks read whatever was set when they launched.
    backend: { getter: b.any, setter: true, capability: "js", throws: true },
    clipboardChangeCount: { returns: b.f64 },
    // System clipboard image reader. `Image | null` — null on Linux (no
    // native API) and when there's no image present. The probe is the
    // cheap "should I show a paste-an-image hint?" check.
    fromClipboard: { returns: b.self.nullable, capability: "js", throws: true },
    hasClipboardImage: { returns: b.bool },
  },
  proto: {
    avif: chainableWithOptions,
    blob: terminal,
    buffer: terminal,
    bytes: terminal,
    // toBase64() with the `data:{mime};base64,` prefix.
    dataurl: terminal,
    flip: chainable,
    flop: chainable,
    heic: chainableWithOptions,
    // Read-only after a pipeline has run; -1 before.
    height: { getter: b.i32 },
    jpeg: chainableWithOptions,
    metadata: terminal,
    modulate: chainableWithOptions,
    // ThumbHash-rendered ≤32px PNG data: URL — ~400-700B, ready for
    // <img src> / blurDataURL.
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
    // Sharp-compat alias for `buffer()`; same native fn, no overhead.
    toBuffer: { ...terminal, rustName: "buffer" },
    webp: chainableWithOptions,
    width: { getter: b.i32 },
    // Encode → fs.writeFile, both off-thread; resolves bytes-written.
    write: { ...terminal, args: { dest: b.any } },
  },
});
