globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
await globalThis.gate;
export const value = "real";
export function call() {
  return "real call";
}
throw new RangeError("from the body");
