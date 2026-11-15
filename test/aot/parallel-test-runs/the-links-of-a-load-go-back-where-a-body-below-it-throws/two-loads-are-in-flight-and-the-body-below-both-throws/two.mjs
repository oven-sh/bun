globalThis.runs ??= {};
globalThis.runs.two = (globalThis.runs.two || 0) + 1;
if (globalThis.failing === "two") {
  globalThis.failing = "";
  throw new Error("made up in two");
}
export const value = "real two " + globalThis.runs.two;
