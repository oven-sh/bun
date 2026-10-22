import { define } from "../../codegen/class-definitions.ts";

// Every member answers the value it was handed, whatever its declaration says, so a test decides whether a declaration
// holds: test/aot/builtins/proven-returns.test.ts. Only `bun:internal-for-testing` hands out the class.
const declaredTypes = {
  string: "string",
  number: "number",
  int32: "int32",
  bigint: "bigint",
  boolean: "boolean",
  undefined: "undefined",
  null: "null",
  object: "object",
  promise: "Promise",
  receiver: "this",
  sameClass: "DeclaredTypesForTesting",
  abortSignal: "AbortSignal",
  array: "Array",
  arrayBuffer: "ArrayBuffer",
  blob: "Blob",
  buffer: "Buffer",
  date: "Date",
  error: "Error",
  headers: "Headers",
  readableStream: "ReadableStream",
  uint8Array: "Uint8Array",
  url: "URL",
  numberOrUndefined: "number | undefined",
  stringOrBufferOrNull: "string | Buffer | null",
};

export default [
  define({
    name: "DeclaredTypesForTesting",
    rustPath: "crate::api::declared_types_testing::DeclaredTypesForTesting",
    construct: true,
    finalize: true,
    configurable: false,
    JSType: "0b11101110",
    values: ["held"],
    klass: {
      number: { fn: "staticAnswerOperand", length: 1, returns: "number", checkedAtRuntime: true },
    },
    proto: {
      ...Object.fromEntries(
        Object.entries(declaredTypes).map(([name, returns]) => [
          name,
          { fn: "answerOperand", length: 1, returns, checkedAtRuntime: true },
        ]),
      ),
      hold: { fn: "hold", length: 1, returns: "undefined", checkedAtRuntime: true },
      heldString: { getter: "getHeld", this: true, type: "string", checkedAtRuntime: true },
      firstHeldString: { getter: "getHeld", this: true, cache: true, type: "string", checkedAtRuntime: true },
    },
  }),
];
