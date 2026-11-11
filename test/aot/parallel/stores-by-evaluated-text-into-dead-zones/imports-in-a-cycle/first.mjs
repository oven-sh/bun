import { seen } from "./second.mjs";
export const early = 1;
export let earlyVariable = 1;
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
export const told = [...seen, "own import, initialized: " + attempt(() => eval("seen = 2")) + " | " + typeof seen];
