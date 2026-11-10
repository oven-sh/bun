import { load } from "./h.mjs";
export let state = "early"; export const get = () => "real " + state;
globalThis.bodies = (globalThis.bodies || 0) + 1; globalThis.begins?.();
await globalThis.gate; const b = await load(); state = "late " + b.read();
