import { define } from "../codegen/class-definitions";

export default [
  define({
    name: "Image",
    construct: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    JSType: "0b11101110",
    klass: {},
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

      // Terminal async ops — run decode → pipeline → encode on the work pool.
      bytes: { fn: "doBytes", length: 0, async: true },
      buffer: { fn: "doBuffer", length: 0, async: true },
      blob: { fn: "doBlob", length: 0, async: true },
      toBase64: { fn: "doToBase64", length: 0, async: true },
      metadata: { fn: "doMetadata", length: 0, async: true },

      // Read-only after a pipeline has run; -1 before.
      width: { getter: "getWidth" },
      height: { getter: "getHeight" },
    },
  }),
];
