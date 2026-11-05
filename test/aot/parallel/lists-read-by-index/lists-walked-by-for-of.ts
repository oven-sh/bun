// A for-of over a list reads it by index where nobody can see the difference: holes, lists that change in the loop, an @@iterator or a prototype of their own, accessors, arguments, a proxy, ways out of the loop.
function report(value: unknown): void { console.log(typeof value === "string" ? JSON.stringify(value) : String(value)); }
let closed = 0;
function join(items: any): string { let s = ""; for (const item of items) s += String(item) + ","; return s; }
function joinList(items: number[]): string { let s = ""; for (const item of items) s += String(item) + ","; return s; }
function joinRest(...items: number[]): string { let s = ""; for (const item of items) s += String(item) + ","; return s; }
function steps(limit: number): any { return { [Symbol.iterator]() { let n = 0; return { next() { n++; return { done: n > limit, value: n }; }, return() { closed++; return {}; } }; } }; }
function pair(n: number): any { return [n, n + 1]; }
report(join([1, , 3]));
report(joinList([1, , 3] as number[]));
report(join([, , ]));
report(joinRest(1, 2, 3));
report(joinRest());
report(join([]));
function literal(a: number, b: number): string { let s = ""; for (const item of [a, b, a + b]) s += String(item) + ","; return s; }
report(literal(1, 2));
function pushes(): string { const list = [1, 2, 3]; let s = ""; for (const item of list) { s += item; if (list.length < 6) list.push(item * 10); } return s + "/" + list.length; }
function pops(): string { const list = [1, 2, 3, 4]; let s = ""; for (const item of list) { s += item; list.pop(); } return s + "/" + list.length; }
function empties(): string { const list = [1, 2, 3, 4]; let s = ""; for (const item of list) { s += item; list.length = 0; } return s + "/" + list.length; }
function replaces(): string { const list = [1, 2, 3, 4]; let s = ""; for (const item of list) { s += item; list[2] = 9; } return s; }
function shifts(): string { const list = [1, 2, 3, 4, 5]; let s = ""; for (const item of list) { s += item; list.shift(); } return s + "/" + list.length; }
report(pushes());
report(pops());
report(empties());
report(replaces());
report(shifts());
function pushesInto(list: number[]): string { let s = ""; for (const item of list) { s += item; if (list.length < 6) list.push(item * 10); } return s + "/" + list.length; }
function popsOff(list: number[]): string { let s = ""; for (const item of list) { s += item; list.pop(); } return s + "/" + list.length; }
function emptiesIt(list: number[]): string { let s = ""; for (const item of list) { s += item; list.length = 0; } return s + "/" + list.length; }
function changedByOther(list: number[], change: (list: number[]) => void): string { let s = ""; for (const item of list) { s += item; change(list); } return s + "/" + list.length; }
report(pushesInto([1, 2, 3]));
report(popsOff([1, 2, 3, 4]));
report(emptiesIt([1, 2, 3, 4]));
report(changedByOther([1, 2, 3, 4], list => { list[3] = 8; }));
report(changedByOther([1, 2, 3, 4], list => { list.length = 2; }));
report(changedByOther([1, 2], list => { if (list.length < 4) list.push(5); }));
class Evens extends Array<number> { *[Symbol.iterator](): any { for (let i = 0; i < this.length; i += 2) yield this[i]; } }
class Plain extends Array<number> {}
const evens = new Evens();
evens.push(1, 2, 3, 4, 5);
const plain = new Plain();
plain.push(7, 8);
report(join(evens));
report(joinList(evens));
report(join(plain));
report(joinList(plain));
const own: any = pair(1);
own[Symbol.iterator] = function* () { yield "a"; yield "b"; yield "c"; };
report(join(own));
report(joinList(own));
report(join(pair(1)));
report(joinList(pair(5)));
function ownHere(): string { const list: any = [1, 2]; list[Symbol.iterator] = function* () { yield "here"; }; let s = ""; for (const item of list) s += item; return s; }
report(ownHere());
function definedHere(): string { const list: any = [1, 2]; Object.defineProperty(list, Symbol.iterator, { value: function* () { yield "defined"; } }); let s = ""; for (const item of list) s += item; return s; }
report(definedHere());
const moved: any = [1, 2, 3];
Object.setPrototypeOf(moved, { [Symbol.iterator]: function* () { yield "moved"; } });
report(join(moved));
report(joinList(moved));
function movedHere(): string { const list: any = [1, 2]; Object.setPrototypeOf(list, { [Symbol.iterator]: function* () { yield "moved here"; } }); let s = ""; for (const item of list) s += item; return s; }
report(movedHere());
const bare: any = [1, 2];
Object.setPrototypeOf(bare, null);
try { report(join(bare)); } catch (error) { report(error instanceof TypeError); }
try { report(joinList(bare)); } catch (error) { report(error instanceof TypeError); }
function setsIteratorInLoop(list: any): string { let s = ""; for (const item of list) { s += item; list[Symbol.iterator] = function* () { yield "x"; }; } return s + join(list); }
report(setsIteratorInLoop([1, 2, 3]));
function movesInLoop(): string { const list: any = [1, , 3]; let s = ""; for (const item of list) { s += String(item) + ","; Object.setPrototypeOf(list, { 1: "above" }); } return s; }
report(movesInLoop());
function movesListInLoop(list: any): string { let s = ""; for (const item of list) { s += String(item) + ","; Object.setPrototypeOf(list, { 1: "above", 2: "higher" }); } return s; }
report(movesListInLoop([1, , , 4]));
function getterInList(): string { const list: any = [1, 2, 3]; let log = ""; Object.defineProperty(list, 1, { get() { log += "g"; list.length = 2; return 7; } }); for (const item of list) log += String(item); return log; }
report(getterInList());
function getterPutInLoop(list: any): string { let log = ""; for (const item of list) { log += String(item); Object.defineProperty(list, 2, { get() { log += "g"; return "late"; }, configurable: true }); } return log; }
report(getterPutInLoop([1, 2, 3, 4]));
function ofArguments(a?: any, b?: any, c?: any): string { let s = ""; for (const item of arguments) s += String(item) + ","; return s; }
report(ofArguments(1, 2)); // @ts-expect-error
report(ofArguments(1, 2, 3, 4));
report(ofArguments());
function ofOwnArguments(a?: any, b?: any): string { (arguments as any)[Symbol.iterator] = function* () { yield "own"; }; return join(arguments); }
report(ofOwnArguments(1, 2));
function throughProxy(): string { let log = ""; const proxy = new Proxy([1, 2], { get(target: any, key: any, receiver: any) { log += (typeof key === "symbol" ? "@" : String(key)) + ";"; return Reflect.get(target, key, receiver); } }); for (const item of proxy) log += "=" + item + ";"; return log; }
report(throughProxy());
function proxyAsList(items: number[]): string { let s = ""; for (const item of items) s += item; return s; }
report(proxyAsList(new Proxy([4, 5], {})));
function breaks(items: any): string { let s = ""; for (const item of items) { s += item; if (item === 2) break; } return s; }
function throwsIn(items: any): string { let s = ""; try { for (const item of items) { s += item; if (item === 2) throw new Error("stop"); } } catch (error: any) { s += error.message; } return s; }
function returnsIn(items: any): string { let s = ""; for (const item of items) { s += item; if (item === 2) return s + "!"; } return s; }
for (const items of [[1, 2, 3], steps(3), [1, 2, 3], new Set([1, 2, 3]), "123", evens]) { report(breaks(items)); report(throwsIn(items)); report(returnsIn(items)); report(closed); }
function breaksList(items: number[]): string { let s = ""; for (const item of items) { s += item; if (item === 2) break; } return s; }
report(breaksList([1, 2, 3]));
report(breaksList(steps(3)));
report(closed);
function nested(list: number[]): string { let s = ""; outer: for (const a of list) { for (const b of list) { if (b === 3) continue outer; if (a === 3) break outer; s += a * 10 + b + ","; } } return s; }
report(nested([1, 2, 3, 4]));
function finallyInLoop(list: number[]): string { let s = ""; for (const item of list) { try { if (item === 2) continue; s += item; } finally { s += "f"; } } return s; }
report(finallyInLoop([1, 2, 3]));
function rebinds(): string { let list = [1, 2, 3]; let s = ""; for (const item of list) { s += item; list = [9]; } return s + list.length; }
report(rebinds());
const sparse: any = [];
sparse[3] = "x";
sparse.length = 5;
report(join(sparse));
function early(items: any): number { let n = 0; for (const item of items) { if (item !== undefined || ++n === 3) break; } return n; }
const huge: any = [];
huge.length = 4294967295;
report(early(huge));
report(joinList(sparse));
function earlyList(items: number[]): number { let n = 0; for (const item of items) { if (item !== undefined || ++n === 3) break; } return n; }
report(earlyList(huge));
function getterThrows(list: any): string { Object.defineProperty(list, 1, { get() { throw new Error("getter"); } }); let s = ""; try { for (const item of list) s += item; } catch (error: any) { s += error.message; } return s; }
report(getterThrows([1, 2, 3]));
function getterThrowsInList(list: number[]): string { Object.defineProperty(list, 1, { get() { throw new Error("getter"); } }); let s = ""; try { for (const item of list) s += item; } catch (error: any) { s += error.message; } return s; }
report(getterThrowsInList([1, 2, 3]));
function capturedList(): string { const list = [1, 2, 3]; const grow = () => { if (list.length < 5) list.push(list.length * 10); }; let s = ""; for (const item of list) { s += item + ","; grow(); } return s; }
report(capturedList());
function handedOver(change: (list: number[]) => void): string { const list = [1, 2]; change(list); let s = ""; for (const item of list) s += item + ","; return s; }
report(handedOver(list => { (list as any)[Symbol.iterator] = function* () { yield "changed"; }; }));
report(handedOver(list => { list.push(3); }));
function literalInLoop(n: number): string { let s = ""; for (let i = 0; i < n; i++) for (const item of [i, i + 1]) s += item; return s; }
report(literalInLoop(3));
function sums(list: number[]): number { let sum = 0; for (const item of list) sum += item; return sum; }
report(sums([1, 2, 3.5]));
report(sums([1, "2", 3] as number[]));
function fields(list: { price: number }[]): number { let sum = 0; for (const item of list) sum += item.price; return sum; }
report(fields([{ price: 1 }, { price: 2.5 }]));
report(fields([{ price: 1 }, { cost: 2, price: 3 } as any, Object.create({ price: 4 })]));
report(join(Object.freeze([1, 2, 3])));
report(joinList(Object.freeze([1, 2, 3]) as number[]));
function* yields(list: number[]): any { for (const item of list) { const sent = yield item; if (sent) list.push(sent); } }
function drive(): string { const generator = yields([1, 2]); let s = ""; let step = generator.next(); let turn = 0; while (!step.done) { s += step.value + ","; step = generator.next(turn++ === 0 ? 7 : 0); } return s; }
report(drive());
async function awaits(list: number[]): Promise<string> { let s = ""; for (const item of list) { s += await Promise.resolve(item); if (list.length < 4) list.push(item + 5); } return s; }
try { report(join(undefined)); } catch (error) { report(error instanceof TypeError); }
try { report(joinList(null as any)); } catch (error) { report(error instanceof TypeError); }
try { report(join(5)); } catch (error) { report(String(error)); }
try { report(join({})); } catch (error) { report(String(error)); }
report(join("a\u{1F600}b"));
report(join(new Uint8Array([1, 2, 3])));
report(join(new Map([[1, 2], [3, 4]])));
report(join(new Set([1, 1, 2])));
report(await awaits([1, 2]));
report("end");
