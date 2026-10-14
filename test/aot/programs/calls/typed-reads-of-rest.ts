// Elements of a rest parameter are read into typed variables, including missing elements and elements of the wrong type.
declare const console: any;
const log: string[] = [];
function note(s: string): number { log.push(s); return 0; }
function firstOfAny(...args: any[]): number { return args[0]; }
function secondOfAny(a: number, ...args: any[]): string { note("before"); const s: string = args[1]; note("after"); return s; }
function firstOfNumbers(...args: number[]): number { return args.length === 0 ? -1 : args[0]; }
function sumOfNumbers(...args: number[]): number { let s = 0; for (let i = 0; i < args.length; i++) s += args[i]; return s; }
function unread(...args: number[]): number { return args.length; }
function unusedRead(...args: any[]): number { const n: number = args[0]; return 7; }
function underHandler(...args: any[]): string { try { const n: number = args[0]; return "number " + n; } catch (e: any) { return "caught " + e.constructor.name + " " + args.length; } }
function optional(...args: any[]): number | undefined { return args[2]; }
function byKey(k: any, ...args: any[]): number { return args[k]; }
const all: [string, any][] = [["firstOfAny", firstOfAny], ["secondOfAny", secondOfAny], ["firstOfNumbers", firstOfNumbers], ["sumOfNumbers", sumOfNumbers], ["unread", unread], ["unusedRead", unusedRead], ["underHandler", underHandler],
  ["optional", optional], ["byKey", byKey]];
const lists: any[][] = [[], [1], [1, 2], [1, 2, 3], ["s"], [1, "s"], [1, 2, "s"], [undefined], [null, null, null], [1.5, -0, NaN], [{}, [], () => 1], [1n], [0, 10, 20], [1, 10, 20], ["length", 1], [-1, 1], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
for (let round = 0; round < 2; round++) {
  for (const [name, f] of all) {
    const out: string[] = [];
    for (const list of lists) { log.length = 0; try { out.push(String(f(...list)) + (log.length ? "(" + log.join() + ")" : "")); } catch (e: any) { out.push("threw " + e.constructor.name + (log.length ? "(" + log.join() + ")" : "")); } }
    console.log(name + ": " + out.join(" | "));
  }
}
export {};
