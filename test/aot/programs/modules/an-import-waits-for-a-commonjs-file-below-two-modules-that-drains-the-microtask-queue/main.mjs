// A CommonJS file two imports below the entry point calls import() and then drainMicrotasks() of bun:jsc: its importers run first, from the bottom up, then the module that the file imported.
import { below } from "./below.mjs";
console.log("main", below);
