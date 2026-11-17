// A pattern over a list reads it by index where nobody can see the difference: swaps of a literal, holes, defaults and targets that change the list, the rest, iterables that have to be closed.
function report(value: unknown): void { console.log(typeof value === "string" ? JSON.stringify(value) : String(value)); }
let closed = 0;
let log = "";
function note(text: string, value: any): any { log += text; return value; }
function steps(limit: number): any { return { [Symbol.iterator]() { let n = 0; return { next() { n++; log += "n"; return { done: n > limit, value: n }; }, return() { closed++; log += "r"; return {}; } }; } }; }
function show(list: any): string { let s = ""; for (let i = 0; i < list.length; i++) s += (i in list ? String(list[i]) : "hole") + ","; return s; }
function swaps(n: number): string { let a = 1, b = 2; for (let i = 0; i < n; i++) [a, b] = [b, a]; return a + "," + b; }
report(swaps(0));
report(swaps(3));
function fibonacci(n: number): number { let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a; }
report(fibonacci(30));
function swapsViews(n: number): number { let a = new Uint32Array(2), b = new Uint32Array(2); a[0] = 1; b[0] = 2; for (let i = 0; i < n; i++) { a[1] += b[0]; [a, b] = [b, a]; } return a[1] * 100 + b[1]; }
report(swapsViews(5));
function swapsMixed(n: number): string { let a: any = 1, b: any = "x"; for (let i = 0; i < n; i++) [a, b] = [b, a]; return typeof a + typeof b; }
report(swapsMixed(3));
function rotates(n: number): string { let a = 1, b = 2, c = 3; for (let i = 0; i < n; i++) [a, b, c] = [b, c, a]; return "" + a + b + c; }
report(rotates(4));
function shortLiteral(): string { const [a, b, c = "d"] = [1] as any[]; return a + "," + b + "," + c; }
report(shortLiteral());
function longLiteral(): string { const [a] = [note("1", 1), note("2", 2), note("3", 3)]; return a + log; }
report(longLiteral());
function holesInLiteral(): string { const [a = 5, b, c = 7] = [, 2, , 4] as any[]; return a + "," + b + "," + c; }
report(holesInLiteral());
function holesInPattern(list: any): string { const [, a, , b] = list; return a + "," + b; }
report(holesInPattern([1, 2, 3, 4]));
report(holesInPattern([1, 2]));
report(holesInPattern([1, , 3, , 5]));
function restOfLiteral(x: number): string { const [a, ...rest] = [x, x + 1, , x + 3]; return a + "/" + show(rest); }
report(restOfLiteral(1));
function restOfList(list: any): string { const [a, b, ...rest] = list; return a + "/" + b + "/" + show(rest); }
report(restOfList([1, 2, 3, 4]));
report(restOfList([1]));
report(restOfList([1, , , , 5]));
report(restOfList("abcd"));
function allOfList(list: number[]): string { const [...all] = list; all.push(9); return show(all) + "/" + list.length; }
report(allOfList([1, 2]));
function sameTarget(): number { let a = 0; [a, a] = [1, 2]; return a; }
report(sameTarget());
function valueOfAssignment(): string { let a = 0, b = 0; const list = ([a, b] = [1, 2]); list.push(3); return a + "," + b + "," + show(list); }
report(valueOfAssignment());
function order(): string { log = ""; const [a, b] = [note("x", 1), note("y", 2)]; return log + a + b; }
report(order());
function defaultsRun(list: any): string { log = ""; const [a = note("a", 1), b = note("b", 2), c = note("c", 3)] = list; return log + "/" + a + b + c; }
report(defaultsRun([]));
report(defaultsRun([7, undefined, null]));
report(defaultsRun([, 8]));
function defaultGrowsList(list: any): string { const [a = (list.push(5, 6, 7), "d"), b, c] = list; return a + "," + b + "," + c + "/" + list.length; }
report(defaultGrowsList([]));
report(defaultGrowsList([undefined]));
report(defaultGrowsList([undefined, 2]));
function defaultShrinksList(list: any): string { const [a = (list.length = 0, "d"), b, c] = list; return a + "," + b + "," + c + "/" + list.length; }
report(defaultShrinksList([undefined, 2, 3]));
function defaultEmptiesAndFills(list: any): string { const [a = (list.length = 1, "d"), b = (list.push(8, 9), "e"), c] = list; return a + "," + b + "," + c + "/" + list.length; }
report(defaultEmptiesAndFills([undefined, 2, 3]));
function freshDefaultGrows(): string { const list: any[] = []; const [a = (list.push(5, 6), "d"), b] = list; return a + "," + b; }
report(freshDefaultGrows());
function freshDefaultReplaces(): string { const list: any[] = [undefined, 2]; const [a = (list[1] = 9, "d"), b] = list; return a + "," + b; }
report(freshDefaultReplaces());
function targetsRun(list: any): string { log = ""; const o: any = { set x(v: any) { log += "x" + v; list.length = 1; }, set y(v: any) { log += "y" + v; } }; [o.x, o.y] = list; return log; }
report(targetsRun([1, 2]));
function targetsByKey(list: any): string { const into: any[] = []; let i = 0; [into[i++], into[i++], into[i++]] = list; return show(into) + i; }
report(targetsByKey([4, 5]));
function nestedPatterns(list: any): string { const [[a, b = "b"], { c }, [d] = ["d"]] = list; return a + "," + b + "," + c + "," + d; }
report(nestedPatterns([[1], { c: 3 }]));
report(nestedPatterns([[1, 2], { c: 3 }, [4]]));
function parameters([a, b = 2]: number[], [c]: any = [3]): string { return a + "," + b + "," + c; }
report(parameters([1]));
report(parameters([1, 5], "xyz"));
function pair(a: number, b: number): [number, number] { return [a, b]; }
function takesPair(n: number): number { let sum = 0; for (let i = 0; i < n; i++) { const [p, q] = pair(i, i + 1); sum += p * q; } return sum; }
report(takesPair(10));
function captured(): string { let a = 1, b = 2; const read = () => a + "," + b; [a, b] = [b, a]; return read(); }
report(captured());
function ofField(o: { tags: number[] }): string { const { tags: [first, second = 3] } = o; return first + "," + second; }
report(ofField({ tags: [1] }));
report(ofField({ tags: [1, 2] }));
function closes(items: any): string { log = ""; const [a, b] = items; return a + "," + b + "/" + log + closed; }
report(closes(steps(5)));
report(closes(steps(2)));
report(closes(steps(1)));
report(closes([1, 2, 3]));
function closesOnThrow(items: any): string { log = ""; try { const [a, b = note("t", (() => { throw new Error("thrown"); })())] = items; return a + "," + b; } catch (error: any) { return error.message + "/" + log + closed; } }
report(closesOnThrow(steps(1)));
report(closesOnThrow({ [Symbol.iterator]() { return { next() { log += "n"; return { done: false, value: undefined }; }, return() { closed++; log += "r"; return {}; } }; } }));
report(closesOnThrow([1]));
report(closesOnThrow([1, 2]));
function nextThrows(): string { log = ""; try { const [a, b] = { [Symbol.iterator]() { let n = 0; return { next() { if (n++) throw new Error("next"); return { done: false, value: 1 }; }, return() { log += "r"; return {}; } }; } } as any; return a + b; } catch (error: any) { return error.message + "/" + log; } }
report(nextThrows());
class Evens extends Array<number> { *[Symbol.iterator](): any { for (let i = 0; i < this.length; i += 2) yield this[i]; } }
const evens = new Evens();
evens.push(1, 2, 3, 4, 5);
function firstTwo(list: number[]): string { const [a, b] = list; return a + "," + b; }
function firstTwoOfAny(list: any): string { const [a, b] = list; return a + "," + b; }
report(firstTwo(evens));
report(firstTwoOfAny(evens));
const own: any = [1, 2, 3];
own[Symbol.iterator] = function* () { yield "a"; yield "b"; };
report(firstTwo(own));
report(firstTwoOfAny(own));
report(firstTwo([1, 2, 3]));
function ownHere(): string { const list: any = [1, 2]; list[Symbol.iterator] = function* () { yield "here"; }; const [a, b] = list; return a + "," + b; }
report(ownHere());
function ofArguments(a?: any, b?: any): string { const [x, y, z] = arguments; return x + "," + y + "," + z; }
report(ofArguments(1, 2));
function throughProxy(): string { let seen = ""; const proxy = new Proxy([1, 2, 3], { get(target: any, key: any, receiver: any) { seen += (typeof key === "symbol" ? "@" : String(key)) + ";"; return Reflect.get(target, key, receiver); } }); const [a, b] = proxy; return seen + a + b; }
report(throughProxy());
function getterInList(): string { const list: any = [1, 2, 3]; let seen = ""; Object.defineProperty(list, 0, { get() { seen += "g"; list.length = 1; return 7; } }); const [a, b, c] = list; return seen + a + "," + b + "," + c; }
report(getterInList());
function getterThrows(list: any): string { Object.defineProperty(list, 1, { get() { throw new Error("getter"); } }); try { const [a, b, c] = list; return a + b + c; } catch (error: any) { return error.message; } }
report(getterThrows([1, 2, 3]));
function getterThrowsInList(list: number[]): string { Object.defineProperty(list, 1, { get() { throw new Error("getter"); } }); try { const [a, b, c] = list; return "" + a + b + c; } catch (error: any) { return error.message; } }
report(getterThrowsInList([1, 2, 3]));
function handedOver(change: (list: number[]) => void): string { const list = [1, 2]; change(list); const [a, b, c] = list; return a + "," + b + "," + c; }
report(handedOver(list => { (list as any)[Symbol.iterator] = function* () { yield "changed"; }; }));
report(handedOver(list => { list.push(3); }));
function swapsFields(o: { a: number; b: number }): string { [o.a, o.b] = [o.b, o.a]; return o.a + "," + o.b; }
report(swapsFields({ a: 1, b: 2 }));
function swapsElements(list: number[], i: number, j: number): string { [list[i], list[j]] = [list[j], list[i]]; return show(list); }
report(swapsElements([1, 2, 3], 0, 2));
report(swapsElements([1, 2, 3], 1, 1));
function reverses(list: number[]): string { for (let i = 0, j = list.length - 1; i < j; i++, j--) [list[i], list[j]] = [list[j], list[i]]; return show(list); }
report(reverses([1, 2, 3, 4, 5]));
function swapsInTry(n: number): string { let a = 1, b = 2; for (let i = 0; i < n; i++) { try { [a, b] = [b, a]; if (i === 1) throw new Error("x"); } catch { a += 10; } } return a + "," + b; }
report(swapsInTry(3));
function greatestCommonDivisor(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }
report(greatestCommonDivisor(1071, 462));
try { const [a] = undefined as any; report(a); } catch (error) { report(error instanceof TypeError); }
try { const [a] = null as any; report(a); } catch (error) { report(error instanceof TypeError); }
try { const [a] = {} as any; report(a); } catch (error) { report(String(error)); }
try { const [a] = 5 as any; report(a); } catch (error) { report(String(error)); }
function ofMap(): string { let s = ""; for (const [key, value] of new Map([["a", 1], ["b", 2]])) s += key + value; return s; }
report(ofMap());
function ofEntries(o: any): string { let s = ""; for (const [key, value] of Object.entries(o)) s += key + value; return s; }
report(ofEntries({ a: 1, b: 2 }));
function ofPairs(pairs: [string, number][]): string { let s = ""; for (const [key, value] of pairs) s += key + value; return s; }
report(ofPairs([["a", 1], ["b", 2]]));
report(closed);
report("end");
