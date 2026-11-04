// A helper or an array method whose own loop calls a closure that the call hands over, called in a loop: what a copy at the call must not change.
const report: (line: string) => void = (globalThis as any).report || console.log;
function each<T>(list: T[], visit: (item: T, index: number) => void): void { for (let i = 0; i < list.length; i++) visit(list[i], i); }
function first<T>(list: T[], test: (item: T) => boolean): T | undefined { for (const item of list) { if (test(item)) return item; } return undefined; }
function fold<T, U>(list: T[], step: (sum: U, item: T) => U, start: U): U { let sum = start; for (let i = 0; i < list.length; i++) sum = step(sum, list[i]); return sum; }
function eachWithThis(this: any, list: number[], visit: (this: any, item: number) => void): void { for (let i = 0; i < list.length; i++) visit.call(this, list[i]); }
function twice(list: number[], visit: (item: number) => void, again: (item: number) => void): void { for (let i = 0; i < list.length; i++) { visit(list[i]); again(list[i]); } }
const lists: number[][] = [[1, 2, 3], [], [4], [5, 6]];
const mixed: any[][] = [[1, "two", null], [undefined, { valueOf() { return 7; } }, 2.5], [, 3] as any[]];

function sums(): string { let out = ""; for (let k = 0; k < lists.length; k++) { let total = 0; each(lists[k], (x, i) => { total += x * (i + 1); }); out += total + ","; } return out; }
function capturesTheTurn(): string { const made: (() => number)[] = []; for (let k = 0; k < lists.length; k++) each(lists[k], x => { made.push(() => x * 10 + k); }); return made.map(f => f()).join(); }
function leavesEarly(): string { let out = ""; for (let k = 0; k < lists.length; k++) out += String(first(lists[k], x => x > 1 && x !== 5)) + ","; return out; }
function throwsInside(): string { let out = ""; for (let k = 0; k < lists.length; k++) { try { each(lists[k], x => { if (x === 2 || x === 6) throw new RangeError("at " + x); out += x; }); out += "."; } catch (error) { out += "(" + (error as Error).message + ")"; } finally { out += ";"; } } return out; }
function changesTheList(): string { let out = ""; for (let k = 0; k < 3; k++) { const list = [1, 2, 3]; each(list, (x, i) => { if (i === 0) list.push(9 + k); if (i === 1) list.length = 3; out += x; }); out += "/" + list.join("") + ","; } return out; }
function callsItself(): string { let out = ""; for (let k = 0; k < 2; k++) each([1, 2], x => { each([x, x + k], y => { out += y; }); out += "|"; }); return out; }
function helperCalledByTheClosure(depth: number): number { let total = 0; for (let k = 0; k < 2; k++) each([1, 2], x => { total += depth ? helperCalledByTheClosure(depth - 1) + x : x; }); return total; }
function foldsObjects(): string { let out = ""; for (let k = 0; k < lists.length; k++) { const r = fold(lists[k], (acc, v) => ({ sum: acc.sum + v, n: acc.n + 1 }), { sum: 0, n: 0 }); out += r.sum + ":" + r.n + ","; } return out; }
function foldsOtherTypes(): string { let out = ""; for (let k = 0; k < mixed.length; k++) out += String(fold(mixed[k], (acc: any, v: any) => acc + v, k ? 0 : "")) + ","; return out; }
function withThis(): string { let out = ""; const holder = { name: "h" }; for (let k = 0; k < 2; k++) eachWithThis.call(holder, lists[k * 3], function (this: any, x: number) { out += this.name + x; }); return out; }
function twoClosures(): string { let out = ""; for (let k = 0; k < 2; k++) twice(lists[0], x => { out += x; }, x => { out += -x; }); return out; }
function sameClosureTwice(): string { let out = ""; for (let k = 0; k < 2; k++) { const show = (x: number) => { out += x + k; }; twice(lists[3], show, show); } return out; }
function namedFunction(): string { let out = ""; function show(x: number) { out += "<" + x + ">"; } for (let k = 0; k < 2; k++) each(lists[3], show); return out; }
function chosenClosure(flag: boolean): string { let out = ""; for (let k = 0; k < 2; k++) each(lists[0], flag ? x => { out += x; } : x => { out += -x; }); return out; }
function closureWithDefaults(): string { let out = ""; for (let k = 0; k < 2; k++) each(lists[3], (x, i = 9, more = "m") => { out += x + ":" + i + more; }); return out; }
function closureWithRest(): string { let out = ""; for (let k = 0; k < 2; k++) each(lists[3], (...all: number[]) => { out += all.length + ":" + all.join("+") + ","; }); return out; }
function closureWithArguments(): string { let out = ""; for (let k = 0; k < 2; k++) each(lists[3], function () { out += arguments.length + ":" + arguments[0] + ","; }); return out; }
function noList(): string { let out = ""; for (let k = 0; k < 2; k++) { try { each(k ? (null as any) : (undefined as any), () => { out += "never"; }); } catch (error) { out += (error as Error).constructor.name + ","; } } return out; }
function notAFunction(): string { let out = ""; for (let k = 0; k < 2; k++) { try { each([1], (k ? 5 : undefined) as any); } catch (error) { out += (error as Error).constructor.name + ","; } } return out; }

function methods(): string {
  let out = "";
  for (let k = 0; k < lists.length; k++) {
    const list = lists[k];
    let seen = "";
    list.forEach((x, i, all) => { seen += x + ":" + i + ":" + (all === list) + " "; });
    out += seen + "|" + list.map(x => x * 2).join() + "|" + list.filter(x => x & 1).join() + "|" + list.reduce((s, x) => s + x, 0) + "|" + list.some(x => x > 4) + "|" + list.every(x => x < 6) + "|" + String(list.find(x => x > 1)) + "|" + list.findIndex(x => x === 6) + ";";
  }
  return out;
}
function methodsOnOtherValues(): string {
  let out = "";
  for (let k = 0; k < mixed.length; k++) out += mixed[k].map(x => typeof x).join() + "|" + mixed[k].filter(x => x != null).length + "|" + (1 in mixed[k].map(x => x)) + "|" + (0 in mixed[k].map(x => x)) + ";";
  return out;
}
function methodThrows(): string { let out = ""; for (let k = 0; k < 3; k++) { try { out += [1, 2, 3].map(x => { if (x === k + 1) throw new Error("no " + x); return x; }).join(); } catch (error) { out += (error as Error).message; } out += ";"; } return out; }
function reduceOfNothing(): string { let out = ""; for (let k = 0; k < 2; k++) { try { out += ([] as number[]).reduce((s, x) => s + x); } catch (error) { out += (error as Error).constructor.name; } } return out; }
function methodChangesTheList(): string { let out = ""; for (let k = 0; k < 2; k++) { const list = [1, 2, 3, 4]; out += list.map((x, i) => { if (i === 0) list.pop(); if (i === 1) list[2] = 30; return x; }).join() + "/" + list.join() + ";"; } return out; }
function methodWithThisArgument(): string { let out = ""; const holder = { scale: 3 }; for (let k = 0; k < 2; k++) out += [1, 2].map(function (this: any, x: number) { return x * this.scale; }, holder).join() + ";"; return out; }
function methodReplaced(): string { let out = ""; const list: any = [1, 2]; for (let k = 0; k < 3; k++) { if (k === 1) list.map = function (f: any) { return ["own", f(0)]; }; if (k === 2) delete list.map; out += list.map((x: number) => x + 1).join() + ";"; } return out; }
class Special extends Array<number> { static get [Symbol.species]() { return Array; } }
class Kept extends Array<number> { }
function species(): string { let out = ""; for (let k = 0; k < 2; k++) { const a = Special.from([1, 2]).map(x => x + k), b = Kept.from([1, 2]).map(x => x + k); out += (a instanceof Special) + "," + (b instanceof Kept) + "," + a.join() + "," + b.join() + ";"; } return out; }
function arrayLikes(): string { let out = ""; for (let k = 0; k < 2; k++) out += Array.prototype.map.call({ length: 2, 0: "a", 1: "b" }, (x: any) => x + k).join() + "|" + Array.prototype.map.call("xy", (x: any) => x + k).join() + ";"; return out; }

for (let turn = 0; turn < 3; turn++) {
  report([sums(), capturesTheTurn(), leavesEarly(), throwsInside(), changesTheList(), callsItself(), helperCalledByTheClosure(2)].join(" # "));
  report([foldsObjects(), foldsOtherTypes(), withThis(), twoClosures(), sameClosureTwice(), namedFunction(), chosenClosure(turn === 1)].join(" # "));
  report([closureWithDefaults(), closureWithRest(), closureWithArguments(), noList(), notAFunction()].join(" # "));
  report([methods(), methodsOnOtherValues(), methodThrows(), reduceOfNothing()].join(" # "));
  report([methodChangesTheList(), methodWithThisArgument(), methodReplaced(), species(), arrayLikes()].join(" # "));
}
report("end");
