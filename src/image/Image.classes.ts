import { define } from "../codegen/class-definitions";

export default [
  define({
    name: "Image",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    // Report owned input (Blob dupe / data:-URL / path string) so a heap of
    // idle Image objects shows up in the GC's accounting. The js_buffer source
    // is the user's ArrayBuffer and already counted via the cached value slot;
    // off-thread RGBA scratch lives only for the task's duration so isn't.
    estimatedSize: true,
    // Strong-ref slot for the input ArrayBuffer/TypedArray so we BORROW its
    // bytes instead of duping in the constructor. While a task is in flight
    // the JSRef on the Zig side holds a Strong ref to this wrapper, the
    // wrapper's sourceJS slot keeps the ArrayBuffer alive, and the buffer is
    // pinned for the task's duration — so the slice stays valid off-thread.
    // (No `hasPendingActivity` polling; the JSRef upgrade/downgrade is
    //  explicit at schedule/then.)
    values: ["sourceJS"],
    configurable: false,
    JSType: "0b11101110",
    klass: {
      // Process-global backend selector: "system" (CoreGraphics/WIC + vImage,
      // default where available) or "bun" (static libjpeg-turbo/spng/libwebp +
      // Highway resize, byte-identical across platforms). Set BEFORE awaiting a
      // pipeline; in-flight tasks read whatever was set when they launched.
      backend: { getter: "getBackend", setter: "setBackend" },
      // System clipboard image reader. `Image | null` — null on Linux (no
      // native API) and when there's no image present. The probe is the
      // cheap "should I show a paste-an-image hint?" check.
      fromClipboard: { fn: "fromClipboard", length: 0 },
      hasClipboardImage: { fn: "hasClipboardImage", length: 0 },
      clipboardChangeCount: { fn: "clipboardChangeCount", length: 0 },
    },
    proto: {
      // Chainable mutators — record an op and return `this`.
      resize: { fn: "doResize", length: 2 },
      rotate: { fn: "doRotate", length: 1 },
      flip: { fn: "doFlip", length: 0 },
      flop: { fn: "doFlop", length: 0 },
      modulate: { fn: "doModulate", length: 1 },
      // Chainable output-format setters (Sharp-style); the encode happens
      // when a terminal below is awaited.
      jpeg: { fn: "doFormatJpeg", length: 1 },
      png: { fn: "doFormatPng", length: 1 },
      webp: { fn: "doFormatWebp", length: 1 },
      heic: { fn: "doFormatHeic", length: 1 },
      avif: { fn: "doFormatAvif", length: 1 },

      // Terminal async ops — run decode → pipeline → encode on the work pool.
      bytes: { fn: "doBytes", length: 0, async: true },
      buffer: { fn: "doBuffer", length: 0, async: true },
      // Sharp-compat alias for `buffer()`; same Zig fn, no overhead.
      toBuffer: { fn: "doBuffer", length: 0, async: true },
      // Encode → fs.writeFile, both off-thread; resolves bytes-written.
      write: { fn: "doWrite", length: 1, async: true },
      blob: { fn: "doBlob", length: 0, async: true },
      toBase64: { fn: "doToBase64", length: 0, async: true },
      // toBase64() with the `data:{mime};base64,` prefix.
      dataurl: { fn: "doDataUrl", length: 0, async: true },
      // ThumbHash-rendered ≤32px PNG data: URL — ~400-700B, ready for
      // <img src> / blurDataURL.
      placeholder: { fn: "doPlaceholder", length: 0, async: true },
      metadata: { fn: "doMetadata", length: 0, async: true },

      // Read-only after a pipeline has run; -1 before.
      width: { getter: "getWidth" },
      height: { getter: "getHeight" },
    },
  }),
];
