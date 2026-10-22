import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "S3Client",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {
      file: {
        fn: "staticFile",
        returns: "Blob",
        checkedAtRuntime: true,
        length: 2,
      },
      unlink: {
        fn: "staticUnlink",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      delete: {
        /// just an alias for unlink
        fn: "staticUnlink",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      list: {
        fn: "staticListObjects",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      presign: {
        fn: "staticPresign",
        returns: "string",
        checkedAtRuntime: true,
        length: 2,
      },
      exists: {
        fn: "staticExists",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      size: {
        fn: "staticSize",
        returns: "number | Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      write: {
        fn: "staticWrite",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      stat: {
        fn: "staticStat",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
    },
    JSType: "0b11101110",
    proto: {
      file: {
        fn: "file",
        returns: "Blob",
        checkedAtRuntime: true,
        length: 2,
      },
      unlink: {
        fn: "unlink",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      delete: {
        /// just an alias for unlink
        fn: "unlink",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      list: {
        fn: "listObjects",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      presign: {
        fn: "presign",
        returns: "string",
        checkedAtRuntime: true,
        length: 2,
      },
      exists: {
        fn: "exists",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      size: {
        fn: "size",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      write: {
        fn: "write",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      stat: {
        fn: "stat",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
    },
  }),
];
