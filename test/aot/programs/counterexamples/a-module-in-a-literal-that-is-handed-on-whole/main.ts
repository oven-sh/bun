// A literal that holds a required module is kept in a const and then passed to a function of another file.
declare const console: { log(...values: unknown[]): void };
import { mod } from "./mod.ts";
import { own } from "./api.ts";
import { reader } from "./reader.ts";
const bag = { api: mod, a: 1, b: 2, c: "c", d: true, e: 5, g: 6, h: 7, i: 8, j: 9 };
try { console.log(await reader("x", 1, bag)); } catch (e) { console.log("THROWN: " + (e as Error).message.split("\n")[0]); }
try { console.log(await reader("y", 1, { api: own, a: 1, b: 2, c: "c", d: true, e: 5, g: 6, h: 7, i: 8, j: 9 })); } catch (e) { console.log("THROWN: " + (e as Error).message.split("\n")[0]); }
