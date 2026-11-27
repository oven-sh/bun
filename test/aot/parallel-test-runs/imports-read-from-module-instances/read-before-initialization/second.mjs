import * as first from "./first.mjs";
import "./dep.mjs";
const tries = [];
for (let i = 0; i < 300; i++) { try { void first.value; tries.push("read"); } catch (error) { tries.push(error.name); } }
globalThis.early = [...new Set(tries)].join();
export const other = 2;
