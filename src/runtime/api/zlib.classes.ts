import { define } from "../../codegen/class-definitions.ts";

function generate(name: string) {
  return define({
    name,
    construct: true,
    noConstructor: false,
    refCounted: true,
    configurable: false,
    estimatedSize: true,
    klass: {},
    JSType: "0b11101110",
    values: ["writeCallback", "errorCallback", "pendingInput", "pendingOutput", "writeResult"],

    proto: {
      init: { fn: "init" },
      write: { fn: "write" },
      writeSync: { fn: "writeSync" },
      params: { fn: "params" },
      reset: { fn: "reset" },
      close: { fn: "close" },
      onerror: { setter: "setOnError", this: true, getter: "getOnError" },
    },
  });
}

export default [generate("NativeZlib"), generate("NativeBrotli"), generate("NativeZstd")];
