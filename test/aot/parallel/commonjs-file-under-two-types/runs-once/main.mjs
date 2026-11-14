// A CommonJS file runs once, also where some of its imports write a type.
import untyped, { increment } from "./counter.cjs";
import { incrementTyped, typed } from "./typed.mjs";

const required = import.meta.require("./counter.cjs");
const called = await import("./counter.cjs", { with: { type: "ts" } });
console.log(globalThis.runs, untyped === typed, required === typed, called.default === typed);
console.log(increment(), incrementTyped(), required.increment(), called.increment());
