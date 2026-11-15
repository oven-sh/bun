globalThis.runs.space = (globalThis.runs.space ?? 0) + 1;
export const file = import.meta.path;
export const folder = import.meta.dir;
export function fail() {
  throw new Error("thrown in a b.mjs");
}
