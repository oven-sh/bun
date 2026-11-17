globalThis.runs.unread = (globalThis.runs.unread ?? 0) + 1;
export function fail() {
  throw new Error("thrown in ø-unread-path.mjs");
}
