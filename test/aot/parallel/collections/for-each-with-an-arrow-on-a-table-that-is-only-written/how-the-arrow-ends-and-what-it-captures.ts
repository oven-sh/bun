// The receiver is written as a Map or a Set and nothing is proven of it: the functions are handed to unseen code. Each runs many times with what is written, and then with what is not.
import vm from "node:vm";
const unseen: any = (0, eval)("(x) => x");
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "string" ? part : JSON.stringify(part) ?? String(part)).join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \((evaluating|near|In) [\s\S]*$/, "")); } };
function throwsAt(members: Map<number, number>, at: number) { const seen: number[] = []; try { members.forEach((value, key) => { seen.push(key); if (key === at) throw new Error("at " + key); }); } catch (error) { seen.push(-1); return seen.join() + " " + String(error); } finally { seen.push(-2); } return seen.join(); }
function reassigns(members: Set<number>) { let total = 0, last: number | undefined, text = ""; members.forEach(value => { total += value; last = value; text += value; }); return [total, last, text]; }
function keepsArrows(members: Set<number>) { const made: (() => number)[] = []; members.forEach(value => { made.push(() => value * 2); }); return made.map(one => one()); }
class Holder { sum = 0; add(members: Set<number>) { members.forEach(value => { this.sum += value; }); return this.sum; } }
function outerArguments(members: Set<number>, _extra?: unknown) { const seen: number[] = []; members.forEach(() => { seen.push(arguments.length); }); return seen; }
function recursive(members: Map<number, Map<number, any> | undefined>, depth: number): number { let count = 1; members.forEach(inner => { if (inner && depth < 4) count += recursive(inner, depth + 1); }); return count; }
function asyncArrow(members: Set<number>, out: number[]) { members.forEach(async value => { await null; out.push(value); }); return out.length; }
function inLoop(tables: Map<number, number>[]) { let total = 0; for (const table of tables) table.forEach(value => { total += value; }); return total; }
async function inAsync(members: Map<number, number>) { let total = 0; await null; members.forEach(value => { total += value; }); await null; members.forEach((_, key) => { total += key; }); return total; }
function* inGenerator(members: Set<number>) { let total = 0; members.forEach(value => { total += value; }); yield total; members.forEach(value => { total -= 1; }); yield total; }
function twoArrows(members: Map<number, number>, flag: boolean) { let a = 0, b = 0; members.forEach(flag ? value => { a += value; } : value => { b += value; }); return [a, b]; }
function sameArrowTwice(members: Set<number>) { let total = 0; const add = (value: number) => { total += value; }; members.forEach(add); members.forEach(add); return total; }
const f = [throwsAt, reassigns, keepsArrows, outerArguments, recursive, asyncArrow, inLoop, inAsync, inGenerator, twoArrows, sameArrowTwice].map(unseen);
for (let turn = 0; turn < 3; turn++) {
  const leaf = new Map<number, any>([[1, undefined]]); const out: number[] = [];
  say(f[0](new Map([[1, 1], [2, 2], [3, 3]]), 2), f[0](new Map([[1, 1]]), 9), f[1](new Set([1, 2, 3])), f[2](new Set([1, 2])), unseen(new Holder()).add(new Set([4, 5])), f[3](new Set([1]), 1), f[4](new Map([[1, leaf], [2, new Map([[1, leaf]])]]), 0));
  say(f[5](new Set([1, 2]), out), f[6]([new Map([[1, 1]]), new Map([[2, 2], [3, 3]])]), await f[7](new Map([[1, 10], [2, 20]])), [...f[8](new Set([1, 2]))], f[9](new Map([[1, 5]]), true), f[9](new Map([[1, 5]]), false), f[10](new Set([1, 2])), out);
  const stranger = { forEach(callback: any) { callback(100, 100); } }; say(f[1](stranger), f[6]([stranger, new Map([[1, 1]])]), await f[7](stranger), [...f[8](stranger)], f[0](stranger, 100));
}
