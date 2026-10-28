// `o.m(args)` on a receiver of unknown type: everything that can observe when the method is read.
const print = (s: string) => console.log(s);
function show(x: unknown): string {
    if (typeof x !== "string")
        return Object.is(x, -0) ? "-0" : String(x);
    let out = '"';
    for (let i = 0; i < x.length; i++) {
        const c = x.charCodeAt(i);
        out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 0x10000).toString(16).slice(1);
    }
    return out + '"';
}
function attempt(f: () => unknown): string {
    try {
        return show(f());
    } catch (e) {
        return "throws " + (e as Error).name;
    }
}
function cat(a: string, b: string): string { return a + b; }
function cat3(a: string, b: string, c: string): string { return `${a}${b}${c}`; }
function part(s: string, from: number, to: number): string { return s.slice(from, to); }
function flattened(s: string): string { s.charCodeAt(0); return s; }

const log: string[] = [];
const noted = (x: any, what: string): any => { log.push(what); return x; };
const told = (f: () => unknown): string => { log.length = 0; const result = attempt(f); return result + " [" + log.join() + "]"; };
// (A) nothing, or constants, between the read and the call.
export function at(s: any, i: any): any { return s.charCodeAt(i); }
export function cutOff(s: any): any { return s.slice(1, 3); }
export function holds(s: any, x: any): any { return s.includes(x); }
export function pushed(a: any, x: any): any { return a.push(x); }
export function got(m: any, k: any): any { return m.get(k); }
export function had(m: any, k: any): any { return m.has(k); }
// (B) something is evaluated in between.
export function atNoted(s: any, i: any): any { return s.charCodeAt(noted(i, "argument")); }
export function atField(s: any, o: any): any { return s.charCodeAt(o.index); }
export function atSum(s: any, i: any, j: any): any { return s.charCodeAt(i + j); }
export function cutNoted(s: any, a: any, b: any): any { return s.slice(noted(a, "first"), noted(b, "second")); }
export function pushedNoted(a: any, f: any): any { return a.push(f(a)); }
export function gotNoted(m: any, f: any): any { return m.get(f(m)); }
export function chosen(s: any, c: any, i: any): any { return s.charCodeAt(c ? i : noted(0, "other")); }
export function caught(s: any, f: any): any { try { return s.charCodeAt(f()); } catch (e) { return "caught " + (e as Error).name; } finally { log.push("finally"); } }
export async function awaited(s: any, p: any): Promise<any> { return s.slice(await p, 4); }
export function* yielded(s: any): Generator<any, any, any> { return s.slice(yield "ask", 4); }
export function looped(list: any, i: any): any { let sum = 0; for (const s of list) sum += s.charCodeAt(noted(i, "a")); return sum; }
export function twice(s: any, i: any): any { return s.charCodeAt(i) + s.charCodeAt(noted(i, "n")) + s.slice(i).length; }
const reading = (name: string, f: any): any => ({ get [name]() { log.push("read"); return f; } });
const receivers = (): [string, any][] => [["string", "abcdef"], ["rope", cat("abc", "def")], ["wide", "─bcdef"], ["String object", new String("abcdef")], ["own method", { charCodeAt: (i: any) => "own " + i, slice: (...a: any[]) => "own " + a, includes: () => "own" }],
    ["getter", { get charCodeAt() { log.push("read"); return (i: any) => "got " + i; }, get slice() { log.push("read"); return (...a: any[]) => "got " + a; }, get includes() { log.push("read"); return () => "got"; } }],
    ["borrowed", { charCodeAt: String.prototype.charCodeAt, slice: String.prototype.slice, includes: String.prototype.includes, toString() { log.push("toString"); return "xyzuvw"; } }],
    ["no method", {}], ["not callable", { charCodeAt: 5, slice: 5, includes: 5 }], ["undefined", undefined], ["null", null], ["number", 12345], ["array", ["p", "q", "r", "s"]], ["proxy", new Proxy({}, { get(_, k) { log.push("trap " + String(k)); return (...a: any[]) => "proxied " + a; } })]];
for (const [name, r] of receivers()) print(name + ": " + [() => at(r, 1), () => cutOff(r), () => holds(r, "c"), () => atNoted(r, 1), () => atField(r, { get index() { log.push("field"); return 2; } }), () => atSum(r, { valueOf() { log.push("valueOf"); return 1; } }, 1), () => cutNoted(r, 1, 3), () => chosen(r, false, 1), () => chosen(r, true, 1), () => caught(r, () => noted(1, "f")), () => caught(r, () => { log.push("f"); throw new RangeError("mine"); }), () => twice(r, 1)].map(told).join(" | "));
// Odd arguments on a string: JavaScriptCore's function is what was read.
print([undefined, null, "1", 1.5, -1, NaN, { valueOf() { log.push("valueOf"); return 2; } }, true, 99, 2n, Symbol.iterator].map(i => told(() => at("abcdef", i)) + told(() => atNoted("abcdef", i))).join(" | "));
// The arguments change the receiver, or what a lookup on it would find: the function that was read earlier is called.
{ const a: any = [1]; print(told(() => pushedNoted(a, (x: any) => { x.push = () => "replaced"; return 2; })) + " " + a.join() + " " + told(() => pushed(a, 3)) + " " + a.join()); }
{ const a: any = [1]; print(told(() => pushedNoted(a, (x: any) => { x.extra = 1; return 2; })) + " " + a.join() + a.extra); }
{ const a: any = [1]; print(told(() => pushedNoted(a, (x: any) => { Object.setPrototypeOf(x, { push: () => "other" }); return 2; })) + " " + Array.prototype.join.call(a) + " " + told(() => pushed(a, 3))); }
{ const a: any = [1]; print(told(() => pushedNoted(a, (x: any) => { x.length = 0; return 2; })) + " " + a.join() + " " + told(() => pushedNoted(a, (x: any) => { Object.freeze(x); return 3; })) + " " + a.join()); }
{ const a: any = [1]; const kept = a.push; a.push = () => "replaced"; print(show(kept === a.push) + " " + show(kept === Array.prototype.push) + " " + told(() => kept.call(a, 2)) + " " + told(() => a.push(3)) + " " + a.join()); }
{ const a: number[] = [1]; const kept = a.push; (a as any).push = () => "replaced"; print(show(kept === a.push) + " " + show(kept === Array.prototype.push) + " " + told(() => kept.call(a, 2)) + " " + told(() => a.push(3)) + " " + a.join()); }
{ const m: any = new Map([["k", 1]]); const kept = m.get; m.get = () => "replaced"; print(show(kept === m.get) + " " + show(kept === Map.prototype.get) + " " + told(() => kept.call(m, "k")) + " " + told(() => m.get("k"))); }
{ const m = new Map([["k", 1]]); const kept = m.get; (m as any).get = () => "replaced"; print(show(kept === m.get) + " " + show(kept === Map.prototype.get) + " " + told(() => kept.call(m, "k")) + " " + told(() => m.get("k"))); }
{ const m: any = new Map([["k", 1]]); print(told(() => gotNoted(m, (x: any) => { x.get = () => "replaced"; return "k"; })) + " " + told(() => got(m, "k")) + " " + told(() => had(m, "k"))); }
{ const m: any = new Map([["k", 1]]); print(told(() => gotNoted(m, (x: any) => { x.set("k", 2); return "k"; })) + " " + told(() => gotNoted(m, (x: any) => { x.clear(); return "k"; }))); }
{ class Mine extends Map<any, any> { get(k: any): any { return "mine " + super.get(k); } } const m: any = new Mine([["k", 1]]); print(told(() => got(m, "k")) + " " + told(() => gotNoted(m, () => "k")) + " " + told(() => had(m, "k"))); }
{ class List extends Array<any> { push(...x: any[]): number { log.push("own push"); return super.push(...x); } } const a: any = new List(); print(told(() => pushed(a, 1)) + " " + told(() => pushedNoted(a, () => 2)) + " " + a.join()); }
print(told(() => got(new Set([1]), 1)) + " " + told(() => had(new Set([1]), 1)) + " " + told(() => had(new WeakMap(), {})) + " " + told(() => pushed("string", 1)) + " " + told(() => pushed(reading("push", (x: any) => "p" + x), 1)) + " " + told(() => pushedNoted(reading("push", (x: any) => "p" + x), () => noted(1, "f"))));
print(told(() => looped(["ab", "cd", new String("ef"), { charCodeAt: () => 1000 }], 1)) + " " + told(() => looped(["ab", undefined], 1)) + " " + told(() => looped([], 1)));
{ const g = yielded("abcdef"); print(show(g.next().value) + show(g.next(2).value)); const h = yielded(reading("slice", (...a: any[]) => "r" + a)); log.length = 0; print(show(h.next().value) + log.join() + show(h.next(2).value) + log.join()); const u = yielded(undefined); print(attempt(() => u.next())); }
(async () => { print(show(await awaited("abcdef", Promise.resolve(2)))); log.length = 0; const p = awaited(reading("slice", (...a: any[]) => "r" + a), new Promise(r => setTimeout(() => { log.push("resolved"); r(1); }, 0))); log.push("called"); print(show(await p) + " " + log.join()); print(await awaited(undefined, 1).then(show, e => "rejected " + e.name)); })();
(globalThis as any).kept = [at, cutOff, holds, pushed, got, had, atNoted, atField, atSum, cutNoted, pushedNoted, gotNoted, chosen, caught, awaited, yielded, looped, twice]; console.log("number");
