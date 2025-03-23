import { define } from "../codegen/class-definitions";

export default [
  define({
    name: "Image",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {
      // Static factory method
      image: {
        fn: "image",
        length: 1,
      },
    },
    proto: {
      // Properties
      encoding: {
        getter: "getEncoding",
        cache: true,
      },
      width: {
        getter: "getWidth",
        cache: true,
      },
      height: {
        getter: "getHeight",
        cache: true,
      },
      name: {
        value: "Image",
      },
      
      // Methods
      size: {
        fn: "size",
        length: 0,
      },
      resize: {
        fn: "resize",
        length: 2,
      },
      bytes: {
        fn: "bytes", 
        length: 0,
      },
      blob: {
        fn: "blob",
        length: 0,
      },
      
      // Format conversion methods
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

      // Utility methods
      ["toString"]: {
        fn: "toString",
        length: 0,
      },
      ["toJSON"]: {
        fn: "toJSON",
        length: 0,
      },
    },
  }),
];