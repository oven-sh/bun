// A spread of a list into a literal, a call, a construction and a call of super reads it by index where nobody can see the difference.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
let closed = 0;
let log = "";
function show(list: any): string { let s = ""; for (let i = 0; i < list.length; i++) s += (i in list ? String(list[i]) : "hole") + ","; return s; }
function steps(limit: number): any { return { [Symbol.iterator]() { let n = 0; return { next() { n++; return { done: n > limit, value: n }; }, return() { closed++; return {}; } }; } }; }
function count(...values: any[]): string { return values.length + ":" + show(values); }
function three(a?: any, b?: any, c?: any): string { return a + "," + b + "," + c + "/" + arguments.length; }
class Point { x: any; y: any; n: number; constructor(x?: any, y?: any) { this.x = x; this.y = y; this.n = arguments.length; } }
let made = "";
class Base { constructor(a?: any, b?: any) { made = a + "," + b + "/" + arguments.length; } }
function whatWasMade(object: Base): string { return (object instanceof Base) + made; }
class Derived extends Base { constructor(...args: any[]) { super(...args); } }
class Wider extends Base { constructor(...args: any[]) { super(0, ...args); } }
function literals(i: number): string { const a = [i, 1]; const b = [2, i + 1]; const all = [...a, ...b]; return all.length + ":" + all[0] + all[3] + "/" + show(all); }
report(literals(5));
function withHoles(): string { const a = [1, , 3]; const all = [...a, , 5]; return show(all) + (1 in all) + (3 in all); }
report(withHoles());
function around(i: number): string { const a = [i]; return show([0, ...a, 2, ...a, ...[], 4]); }
report(around(1));
function copy(list: number[]): string { const all = [...list]; all.push(9); return show(all) + "/" + show(list); }
report(copy([1, 2]));
report(copy([1, , 3] as number[]));
function copyOfAny(list: any): string { return show([...list]); }
report(copyOfAny([1, 2]));
report(copyOfAny("a\u{1F600}"));
report(copyOfAny(new Set([1, 2])));
report(copyOfAny(new Map([[1, 2]])));
report(copyOfAny(new Uint8Array([1, 2])));
report(copyOfAny(steps(3)));
report(closed);
function twice(list: number[]): string { return show([...list, ...list]); }
report(twice([1, 2]));
function orderOfSpread(): string { const a = [1, 2]; return show([...a, a.push(3), ...a]); }
report(orderOfSpread());
function calls(i: number): string { const a = [i, 1, 2]; return count(...a, 4) + count(1, ...a) + count(...a, ...a) + count(...[]) + count(...[i, i]); }
report(calls(7));
function callsThree(list: any): string { return three(...list) + three(0, ...list) + three(...list, 9); }
report(callsThree([1, 2]));
report(callsThree([]));
report(callsThree([1, 2, 3, 4]));
report(callsThree([, 2]));
report(callsThree("ab"));
function callsFresh(i: number): string { return three(...[i, i + 1]) + three(...[i], ...[i + 1, i + 2]); }
report(callsFresh(1));
function constructs(list: any): string { const p = new Point(...list); return p.x + "," + p.y + "/" + p.n; }
report(constructs([1, 2]));
report(constructs([1]));
report(constructs([1, 2, 3]));
function constructsFresh(i: number): string { const p = new Point(...[i, i + 1]); return p.x + "," + p.y + "/" + p.n; }
report(constructsFresh(4));
report(whatWasMade(new Derived(1, 2)));
report(whatWasMade(new Derived()));
report(whatWasMade(new Derived(1, 2, 3)));
report(whatWasMade(new Wider(1, 2)));
function supers(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += whatWasMade(new Derived(i, 1)) + ";"; return s; }
report(supers(3));
function largest(i: number): number { const a = [i, 1, 2]; return Math.max(...a); }
report(largest(0));
report(largest(9));
function largestOf(list: number[]): number { return Math.max(...list); }
report(largestOf([3, 8, 1]));
report(largestOf([]));
function applies(i: number): string { return count.apply(null, [i, 1, 2]) + three.apply(null, [i] as any); }
report(applies(3));
function methods(list: any): string { const into: any[] = [0]; into.push(...list); return show(into); }
report(methods([1, 2]));
report(methods([]));
class Evens extends Array<number> { *[Symbol.iterator](): any { for (let i = 0; i < this.length; i += 2) yield this[i]; } }
const evens = new Evens();
evens.push(1, 2, 3, 4, 5);
report(copy(evens));
report(copyOfAny(evens));
report(callsThree(evens));
report(constructs(evens));
const own: any = [1, 2, 3];
own[Symbol.iterator] = function* () { yield "a"; yield "b"; };
report(copy(own));
report(copyOfAny(own));
report(callsThree(own));
function ownHere(): string { const list: any = [1, 2]; list[Symbol.iterator] = function* () { yield "here"; }; return show([...list]) + count(...list); }
report(ownHere());
function movedHere(): string { const list: any = [1, 2]; Object.setPrototypeOf(list, { [Symbol.iterator]: function* () { yield "moved"; } }); return show([...list]) + count(...list); }
report(movedHere());
function restWithOwn(...args: any[]): string { (args as any)[Symbol.iterator] = function* () { yield "rest"; }; return count(...args); }
report(restWithOwn(1, 2));
function ofArguments(a?: any, b?: any): string { return count(...arguments) + show([...arguments]); } // @ts-expect-error
report(ofArguments(1, 2, 3));
function throughProxy(): string { let seen = ""; const proxy = new Proxy([1, 2], { get(target: any, key: any, receiver: any) { seen += (typeof key === "symbol" ? "@" : String(key)) + ";"; return Reflect.get(target, key, receiver); } }); return show([...proxy]) + seen; }
report(throughProxy());
function getterInList(): string { const list: any = [1, 2, 3]; Object.defineProperty(list, 0, { get() { log += "g"; list.length = 2; return 7; } }); return show([...list]) + log; }
report(getterInList());
function getterGrows(list: any): string { Object.defineProperty(list, 0, { get() { if (list.length < 4) list.push(9); return 7; } }); return show([...list]); }
report(getterGrows([1, 2]));
try { report(show([...(undefined as any)])); } catch (error) { report(String(error)); }
try { report(count(...(null as any))); } catch (error) { report(String(error)); }
try { report(show([...({} as any)])); } catch (error) { report(String(error)); }
try { report(count(...(5 as any))); } catch (error) { report(String(error)); }
report(closed);
report("end");
