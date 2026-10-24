import * as b from "../../codegen/bindgen-lib.ts";
import { PostgresSQLConnection } from "./PostgresSQLConnection.bind.ts";

const js = { capability: "js", throws: true } as const;

export const PostgresSQLQuery = b.class({
  rustPath: "crate::postgres::PostgresSQLQuery",
  refCounted: true,
  finalize: true,
  estimatedSize: true,
  internalFields: ["pendingValue", "target", "binding", "copy"],
  proto: {
    cancel: { capability: "js" },
    copyDone: { capability: "js" },
    copyFail: { args: { message: b.string.loose.utf8 }, capability: "js" },
    copyResume: {},
    copyWrite: {
      args: { chunk: b.bytes({ from: ["string", "buffer"], held: "handle" }) },
      expected: { chunk: ["string", "TypedArray", "DataView", "ArrayBuffer"] },
      returns: b.bool,
      capability: "js",
    },
    describeResult: { ...js, args: { number: b.f64 }, returns: b.object.nullable },
    run: {
      ...js,
      args: { connection: PostgresSQLConnection, query: b.object },
      expected: { query: "Expected query to be a Query for 'run'." },
      passThis: true,
    },
    setCopy: { args: { callback: b.callable.otherAsNull, writable: b.bool.loose }, capability: "js", passThis: true },
    setMode: {
      ...js,
      args: { mode: b.f64.withValue },
      expected: { mode: "Expected mode to be a Number for 'setMode'." },
    },
    setPendingValue: {
      args: { value: b.opaque },
      capability: "js",
      passThis: true,
    },
  },
});
