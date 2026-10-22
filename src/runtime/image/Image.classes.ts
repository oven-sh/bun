import { define } from "../../codegen/class-definitions.ts";

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
    // the JSRef on the native side holds a Strong ref to this wrapper, the
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
      backend: { getter: "getBackend", type: "string", checkedAtRuntime: true, setter: "setBackend" },
      // System clipboard image reader. `Image | null` — null on Linux (no
      // native API) and when there's no image present. The probe is the
      // cheap "should I show a paste-an-image hint?" check.
      fromClipboard: { fn: "fromClipboard", returns: "Image | null", checkedAtRuntime: true, length: 0 },
      hasClipboardImage: { fn: "hasClipboardImage", returns: "boolean", checkedAtRuntime: true, length: 0 },
      clipboardChangeCount: { fn: "clipboardChangeCount", returns: "number", checkedAtRuntime: true, length: 0 },
    },
    proto: {
      // Chainable mutators — record an op and return `this`.
      resize: { fn: "doResize", returns: "this", checkedAtRuntime: true, length: 2 },
      rotate: { fn: "doRotate", returns: "this", checkedAtRuntime: true, length: 1 },
      flip: { fn: "doFlip", returns: "this", checkedAtRuntime: true, length: 0 },
      flop: { fn: "doFlop", returns: "this", checkedAtRuntime: true, length: 0 },
      modulate: { fn: "doModulate", returns: "this", checkedAtRuntime: true, length: 1 },
      // Chainable output-format setters (Sharp-style); the encode happens
      // when a terminal below is awaited.
      jpeg: { fn: "doFormatJpeg", returns: "this", checkedAtRuntime: true, length: 1 },
      png: { fn: "doFormatPng", returns: "this", checkedAtRuntime: true, length: 1 },
      webp: { fn: "doFormatWebp", returns: "this", checkedAtRuntime: true, length: 1 },
      heic: { fn: "doFormatHeic", returns: "this", checkedAtRuntime: true, length: 1 },
      avif: { fn: "doFormatAvif", returns: "this", checkedAtRuntime: true, length: 1 },

      // Terminal async ops — run decode → pipeline → encode on the work pool.
      bytes: { fn: "doBytes", returns: "Promise", checkedAtRuntime: true, length: 0, async: true },
      buffer: { fn: "doBuffer", returns: "Promise", checkedAtRuntime: true, length: 0, async: true },
      // Sharp-compat alias for `buffer()`; same native fn, no overhead.
      toBuffer: { fn: "doBuffer", returns: "Promise", checkedAtRuntime: true, length: 0, async: true },
      // Encode → fs.writeFile, both off-thread; resolves bytes-written.
      write: { fn: "doWrite", returns: "Promise", checkedAtRuntime: true, length: 1, async: true },
      blob: { fn: "doBlob", returns: "Promise", checkedAtRuntime: true, length: 0, async: true },
      toBase64: { fn: "doToBase64", returns: "Promise", checkedAtRuntime: true, length: 0, async: true },
      // toBase64() with the `data:{mime};base64,` prefix.
      dataurl: { fn: "doDataUrl", returns: "Promise", checkedAtRuntime: true, length: 0, async: true },
      // ThumbHash-rendered ≤32px PNG data: URL — ~400-700B, ready for
      // <img src> / blurDataURL.
      placeholder: { fn: "doPlaceholder", returns: "Promise", checkedAtRuntime: true, length: 0, async: true },
      metadata: { fn: "doMetadata", returns: "Promise", checkedAtRuntime: true, length: 0, async: true },

      // Read-only after a pipeline has run; -1 before.
      width: { getter: "getWidth", type: "int32", pure: true },
      height: { getter: "getHeight", type: "int32", pure: true },
    },
  }),
];
