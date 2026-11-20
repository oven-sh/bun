// What reads a list for itself: apply, Array.from, the constructors of Set and Map, Object.fromEntries, Promise.all, over lists with and without an iteration of their own.
function report(value: unknown): void { console.log(typeof value === "string" ? JSON.stringify(value) : String(value)); }
function show(list: any): string { let s = ""; for (let i = 0; i < list.length; i++) s += (i in list ? String(list[i]) : "hole") + ","; return s; }
class Evens extends Array<number> { *[Symbol.iterator](): any { for (let i = 0; i < this.length; i += 2) yield this[i]; } }
const evens = new Evens();
evens.push(1, 2, 3, 4, 5);
const own: any = [1, 2, 3];
own[Symbol.iterator] = function* () { yield "a"; yield "b"; };
function count(...values: any[]): string { return values.length + ":" + show(values); }
function three(a?: any, b?: any, c?: any): string { return a + "," + b + "," + c + "/" + arguments.length; }
function applies(i: number): string { return count.apply(null, [i, 1, 2]) + three.apply(null, [i] as any) + Reflect.apply(count, null, [i, i]); }
report(applies(3));
function appliesList(list: any): string { return count.apply(null, list) + three.apply(null, list); }
report(appliesList([1, 2]));
report(appliesList(evens));
report(appliesList(own));
report(appliesList({ length: 2, 0: "x", 1: "y" }));
function consumers(list: any): string { return show(Array.from(list)) + show(Array.from(list, (x: any) => x * 2)) + new Set(list).size + show(Array.of(...list)); }
report(consumers([1, 2, 2]));
report(consumers([1, , 2]));
report(consumers(evens));
report(consumers(own));
function maps(pairs: any): string { const map = new Map(pairs); let s = ""; map.forEach((value: any, key: any) => { s += key + "=" + value + ";"; }); return s + JSON.stringify(Object.fromEntries(pairs)); }
report(maps([["a", 1], ["b", 2]]));
async function all(list: any): Promise<string> { return show(await Promise.all(list)); }
report(await all([1, Promise.resolve(2), 3]));
report(await all(evens));
report(await all(own));
report("end");
