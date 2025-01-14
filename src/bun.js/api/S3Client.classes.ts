import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "S3Client",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {
      file: {
        fn: "staticFile",
        length: 2,
      },
      unlink: {
        fn: "staticUnlink",
        length: 2,
      },
      delete: {
        /// just an alias for unlink
        fn: "staticUnlink",
        length: 2,
      },
      presign: {
        fn: "staticPresign",
        length: 2,
      },
      exists: {
        fn: "staticExists",
        length: 2,
      },
      size: {
        fn: "staticSize",
        length: 2,
      },
      write: {
        fn: "staticWrite",
        length: 2,
      },
      stat: {
        fn: "staticStat",
        length: 2,
      },
    },
    JSType: "0b11101110",
    proto: {
      file: {
        fn: "file",
        length: 2,
      },
      unlink: {
        fn: "unlink",
        length: 2,
      },
      delete: {
        /// just an alias for unlink
        fn: "unlink",
        length: 2,
      },
      presign: {
        fn: "presign",
        length: 2,
      },
      exists: {
        fn: "exists",
        length: 2,
      },
      size: {
        fn: "size",
        length: 2,
      },
      write: {
        fn: "write",
        length: 2,
      },
      stat: {
        fn: "stat",
        length: 2,
      },
    },
  }),
];
