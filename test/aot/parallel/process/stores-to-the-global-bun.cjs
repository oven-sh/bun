// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
"use strict";
const attempts = [
  () => {
    globalThis.Bun = undefined;
  },
  () => {
    Bun = undefined;
  },
  () => delete globalThis.Bun,
  () => Object.defineProperty(globalThis, "Bun", { value: undefined }),
  () => Reflect.set(globalThis, "Bun", undefined),
  () => Reflect.deleteProperty(globalThis, "Bun"),
];
for (const attempt of attempts) {
  try {
    console.log(attempt());
  } catch (error) {
    console.log(error.name);
  }
  console.log(typeof Bun, typeof globalThis.Bun, "Bun" in globalThis, typeof Bun === "undefined" ? "other" : "bun");
}
