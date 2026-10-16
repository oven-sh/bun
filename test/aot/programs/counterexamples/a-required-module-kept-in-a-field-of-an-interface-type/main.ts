// What `require()` returns is stored in a field whose type is an interface or null.
declare const console: { log(...values: unknown[]): void };
declare function require(name: string): any;
interface Api { f(x: number): number }
const own: Api = { f: x => x * 2 };
function on(): boolean { return true }
const mod = on() ? (require("./m.ts") as typeof import("./m.ts")) : null;
class Keeper { api: Api | null = null; use(n: number) { return this.api?.f(n) } }
const k = new Keeper();
console.log(k.use(1)); k.api = own; console.log(k.use(1)); k.api = mod; console.log(k.use(1));
