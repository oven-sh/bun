// Every member answers the value it was handed, whatever it declares: test/aot/builtins/proven-returns.test.ts.
import * as b from "../../codegen/bindgen-lib.ts";

const declaredTypes: Record<string, readonly string[]> = {
  string: ["string"],
  number: ["number"],
  int32: ["int32"],
  bigint: ["bigint"],
  boolean: ["boolean"],
  undefined: ["undefined"],
  null: ["null"],
  object: ["object"],
  promise: ["Promise"],
  receiver: ["this"],
  sameClass: ["DeclaredTypesForTesting"],
  abortSignal: ["AbortSignal"],
  array: ["Array"],
  arrayBuffer: ["ArrayBuffer"],
  blob: ["Blob"],
  buffer: ["Buffer"],
  date: ["Date"],
  error: ["Error"],
  headers: ["Headers"],
  readableStream: ["ReadableStream"],
  uint8Array: ["Uint8Array"],
  url: ["URL"],
  numberOrUndefined: ["number", "undefined"],
  stringOrBufferOrNull: ["string", "Buffer", "null"],
};

const answer = (rustName: string, types: readonly string[]) =>
  ({ args: { value: b.any }, returns: b.any.returning(...types), capability: "heap", rustName }) as const;
const held = { getter: b.any.returning("string"), capability: "heap", passThis: true, rustName: "held" } as const;

export const DeclaredTypesForTesting = b.class({
  rustPath: "crate::api::declared_types_testing::DeclaredTypesForTesting",
  construct: {},
  internalFields: ["held"],
  proto: {
    ...Object.fromEntries(
      Object.entries(declaredTypes).map(([name, types]) => [name, answer("answer_operand", types)] as const),
    ),
    hold: { args: { value: b.any }, capability: "heap", passThis: true },
    heldString: held,
    firstHeldString: { ...held, cache: true },
  },
  static: {
    number: answer("static_answer_operand", ["number"]),
  },
});
