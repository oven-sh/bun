import * as passing from "./barrel.mjs";
import { hold } from "./reader.mjs";
globalThis.first ??= passing;
export let value = (globalThis.runs = (globalThis.runs ?? 0) + 1) * 100;
export const bump = () => ++value;
hold(bump);
if (globalThis.runs === 1) throw new Error("first run");
