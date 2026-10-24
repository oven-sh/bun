// The entry point imports a CommonJS file by its default and by a name, a module that hands on a name of a second file, and hands on all names of a third.
// The second file requires the entry point, which has not come to the third file yet.
import whole, { second } from "./both.cjs";
import * as handsOn from "./hands-on.mjs";
export * from "./stars.cjs";
globalThis.ran.push(`main ${typeof whole} ${second} ${Object.keys(handsOn).join()}`);
