import { define } from "../codegen/class-definitions";

export default [
  // A *lazy* image.
  define({
    name: "Image",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    proto: {
      // Properties
      encoding: {
        getter: "getEncoding",
        cache: true,
      },
      name: {
        value: "Image",
      },

      // Methods
      //
      dimensions: {
        fn: "size",
        length: 0,
      },

      resize: {
        fn: "resize",
        length: 2,
      },

      // Promise<Uint8Array>
      bytes: {
        fn: "bytes",
        length: 0,
      },
      // Promise<Blob>
      blob: {
        fn: "blob",
        length: 0,
      },
      // Promise<ArrayBuffer>
      arrayBuffer: {
        fn: "arrayBuffer",
        length: 0,
      },

      // Format conversion methods
      // Each of these return a Promise<Image>
      jpg: {
        fn: "toJPEG",
        length: 1,
      },
      png: {
        fn: "toPNG",
        length: 1,
      },
      webp: {
        fn: "toWEBP",
        length: 1,
      },
      avif: {
        fn: "toAVIF",
        length: 1,
      },
      tiff: {
        fn: "toTIFF",
        length: 1,
      },
      heic: {
        fn: "toHEIC",
        length: 1,
      },
    },
  }),
];
