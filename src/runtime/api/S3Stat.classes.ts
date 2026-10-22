import { define } from "../../codegen/class-definitions.ts";

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
        type: "number",
        cache: true,
      },
      lastModified: {
        getter: "getLastModified",
        type: "Date",
        checkedAtRuntime: true,
        cache: true,
      },
      etag: {
        getter: "getEtag",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      type: {
        getter: "getContentType",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
    },
  }),
];
