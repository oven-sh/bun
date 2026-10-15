// Reads of a rest parameter or of `arguments` with keys that are not valid indices.
// IR= 0 byBoolean CreateRest
// IR= 1 byBoolean GetMyArgumentByVal
// IR= 1 byInteger GetMyArgumentByVal
// IR= 1 typedInteger GetMyArgumentByVal
// IR= 0 typedInteger CreateRest
// IR= 1 typedNumber GetMyArgumentByVal
// IR= 1 typedString GetMyArgumentByVal
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
// Typed, and otherwise without effects: their effect summary consists of the read of the argument.
function typedInteger(...args: unknown[]): number { let n = 0; for (let i = args.length + 1; i >= -1; i--) if (args[i] === undefined) n++; return n; }
function typedNumber(k: number, ...args: unknown[]): boolean { return args[k] === undefined; }
function typedString(k: string, ...args: unknown[]): boolean { return (args as any)[k] === undefined; }
function typedAny(k: any, ...args: unknown[]): boolean { return args[k] === undefined; }
class Holder { count = 0; static made<U>(...values: U[]): Holder | null { let h: Holder | null = null; for (let i = values.length - 1; i >= 0; i--) { const next: Holder = new Holder(); next.count = (h === null ? 0 : h.count) + (values[i] === undefined ? 0 : 1); h = next; } return h; } }
const typed: any = { typedInteger, typedNumber, typedString, typedAny };
const show = (table: any, name: string, ...given: any[]) => { let r: any; try { r = table[name](...given); } catch (e: any) { r = "threw " + e.constructor.name + " " + e.message; } console.log(name, given.length, String(r)); };
const lists: any[][] = [[], ["a"], ["a", "b"], ["a", "b", "c"], [1, "b", "c", "d", "e", "f", "g", "h", "i", "j"], [undefined, undefined], [0, "b"], [true, "b", "c"], [false, "b", "c"]];
for (let round = 0; round < 2; round++) {
  for (const name of Object.keys(m)) for (const list of lists) show(m, name, ...list);
  for (const list of lists) show(typed, "typedInteger", ...list);
  for (const key of [0, 1, 2, 3, -1, -0, 0.5, 1.0000000001, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967295, 4294967296, 4294967297, -2147483648, -2147483649, 9007199254740991, 1e21, 5e-324]) {
    show(typed, "typedNumber", key, "a", "b"); show(typed, "typedAny", key, "a", "b"); show(m, "byAnything", key, "a", "b"); show(m, "byAnythingOfArguments", key, "a", "b");
  }
  for (const key of ["0", "1", "2", "-0", "01", "1.0", " 1", "length", "map", "constructor", "__proto__", "", "x", "4294967295"]) {
    show(typed, "typedString", key, "a", "b"); show(typed, "typedAny", key, "a", "b"); show(m, "byAnything", key, "a", "b"); show(m, "byAnythingOfArguments", key, "a", "b");
  }
  for (const key of [true, false, null, undefined, 0n, 1n, 2n, Symbol.iterator, Symbol("s"), [1], [], {}, { valueOf() { return 1; } }, { toString() { return "1"; } }, { [Symbol.toPrimitive]() { return 0; } }, new Number(1), new String("1")]) {
    show(typed, "typedAny", key, "a", "b"); show(m, "byAnything", key, "a", "b"); show(m, "byAnythingOfArguments", key, "a", "b");
  }
  console.log(Holder.made<unknown>(1, undefined, "x")!.count, Holder.made(), Holder.made<unknown>(undefined)!.count, (Holder.made as any)(1, 2, 3, 4, 5, 6, 7, 8, 9).count);
}
export {};
