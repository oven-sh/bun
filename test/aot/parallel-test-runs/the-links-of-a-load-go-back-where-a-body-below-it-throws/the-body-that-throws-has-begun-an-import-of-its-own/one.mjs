globalThis.runs ??= {};
globalThis.runs.one = (globalThis.runs.one || 0) + 1;
globalThis.aside = import("./aside.mjs").then(it => it.word);
if (globalThis.failing === "one") {
  globalThis.failing = "";
  throw new Error("made up in one");
}
export const value = "real one " + globalThis.runs.one;
