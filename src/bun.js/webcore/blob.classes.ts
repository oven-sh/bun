import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Blob",
    construct: true,
    finalize: true,
    configurable: false,
    estimatedSize: true,
    structuredClone: true,
    klass: {},
    proto: {
      arrayBuffer: { fn: "getArrayBuffer", async: true },
      bytes: { fn: "getBytes", async: true },
      exists: { fn: "getExists", async: true },
      formData: { fn: "getFormData", async: true },
      json: { fn: "getJSON", async: true },
      lastModified: { getter: "getLastModified" },
      name: { accessor: { getter: "getName", setter: "setName" }, this: true },
      size: { getter: "getSize" },
      slice: { fn: "getSlice" },
      stat: { fn: "getStat", async: true },
      stream: { fn: "getStream" },
      text: { fn: "getText", async: true },
      type: { getter: "getType" },
      unlink: { fn: "doUnlink", async: true },
      write: { fn: "doWrite", async: true },
      writer: { fn: "getWriter" },
      lines: { fn: "getLines" },
    },
  }),
];
