import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "S3Stat",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      size: {
        getter: "getSize",
        cache: true,
      },
      lastModified: {
        getter: "getLastModified",
        cache: true,
      },
      etag: {
        getter: "getEtag",
        cache: true,
      },
      type: {
        getter: "getContentType",
        cache: true,
      },
    },
  }),
];
