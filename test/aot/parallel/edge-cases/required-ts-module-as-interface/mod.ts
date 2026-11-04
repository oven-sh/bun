declare function require(name: string): any;
function on(): boolean { return true }
export const mod = on() ? (require("./m.ts") as typeof import("./m.ts")) : null;
