import { define } from "../../codegen/class-definitions.ts";

function generate(name: string) {
  return define({
    name,
    types: [{ path: ["$ZigGeneratedClasses", name], isView: false, typeArguments: [] }],
    construct: true,
    noConstructor: false,
    refCounted: true,
    configurable: false,
    estimatedSize: true,
    klass: {},
    JSType: "0b11101110",
    values: ["writeCallback", "errorCallback", "pendingInput", "pendingOutput", "writeResult"],

    proto: {
      init: { fn: "init", returns: "boolean | undefined", checkedAtRuntime: true },
      write: { fn: "write", returns: "undefined", checkedAtRuntime: true },
      writeSync: { fn: "writeSync", returns: "undefined", checkedAtRuntime: true },
      params: { fn: "params", returns: "undefined", checkedAtRuntime: true },
      reset: { fn: "reset", returns: "undefined", checkedAtRuntime: true },
      close: { fn: "close", returns: "undefined", checkedAtRuntime: true },
      onerror: { setter: "setOnError", this: true, getter: "getOnError" },
    },
  });
}

export default [generate("NativeZlib"), generate("NativeBrotli"), generate("NativeZstd")];
