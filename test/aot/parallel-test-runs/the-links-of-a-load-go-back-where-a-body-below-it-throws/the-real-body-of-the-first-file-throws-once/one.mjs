globalThis.runs ??= {};
globalThis.runs.one = (globalThis.runs.one || 0) + 1;
if (globalThis.failing === "one") {
  globalThis.failing = "";
  throw new Error("made up in one");
}
export const value = "real one " + globalThis.runs.one;
