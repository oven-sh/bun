import * as all from "./tools";
const which = (globalThis as any).never ? "first" : "second";
console.log((all as any)[which]());