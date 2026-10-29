// What was observed, in words.
import { types } from "node:util";
import type { LogEvent, Origin } from "./log";
import { describeOperand, isObject, spellingOf, unreachable } from "./table-description";

export function describeKey(key: PropertyKey | undefined): string {
  return key === undefined ? "" : ` ${typeof key === "string" ? JSON.stringify(key) : spellingOf(key)}`;
}

export function describeOrigin(origin: Origin): string {
  switch (origin.kind) {
    case "Operand":
      return describeOperand(origin.operand);
    case "Content":
      return `${origin.content}${describeKey(origin.key)} at depth ${origin.depth} of ${describeOperand(origin.operand)}`;
    case "CallbackResult":
      return `what ${describeOrigin(origin.callee)} returned`;
    default:
      return unreachable(origin);
  }
}

export function describeEvent({ trap, key, origin, isLate }: LogEvent): string {
  return `${trap}${describeKey(key)} on ${describeOrigin(origin)}${isLate ? ", after the call returned" : ""}`;
}

export function describeError(error: unknown): string {
  if (!isObject(error) || types.isProxy(error)) return "a value that is no Error";
  return error instanceof Error ? `${error.name}: ${error.message.slice(0, 120)}` : "an object that is no Error";
}
