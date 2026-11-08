import { tools } from "./barrel.mjs";
function attempt(what) { try { return String(what()); } catch (e) { return e.name; } }
console.log(attempt(() => Object.freeze(tools) === tools), attempt(() => Object.seal(tools) === tools), attempt(() => Reflect.defineProperty(tools, "alpha", {})));
