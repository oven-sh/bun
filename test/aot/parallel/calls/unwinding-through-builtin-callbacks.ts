// Exceptions that unwind through callbacks of built-ins, `Reflect.apply`, `call`, `apply`, bound functions and promise reactions.
declare const console: any;
const lines: Array<Promise<string>> = [];
function row(n: string, f: () => unknown): void {
    let p: unknown;
    try { p = f(); } catch (e: any) { lines.push(Promise.resolve(n + ": THREW TO THE CALLER " + e.constructor.name)); return; }
    if (!(p instanceof Promise)) { lines.push(Promise.resolve(n + ": returned what is no promise: " + JSON.stringify(p))); return; }
    lines.push(p.then(v => n + ": returned; fulfilled " + JSON.stringify(v), e => n + ": returned; rejected " + e.constructor.name));
}
interface Point { x: number; y: number }
async function takesArray(a: number[]): Promise<number> { return a.length; }
async function takesPoint(p: Point): Promise<number> { return p.x + p.y; }
async function takesPattern([z]: number[]): Promise<number> { return z; }
async function takesPoints(ps: Point[]): Promise<number> { return ps.length; }
async function takesNested(o: { name: string; at: Point }): Promise<number> { return o.at.x; }
async function takesLists(ls: number[][]): Promise<number> { return ls.length; }
async function sinks(f: any, n: number): Promise<number> { return f(f, n + 1); }
const table: any[] = [takesArray, takesPoint, takesPattern, takesPoints, takesNested, takesLists, sinks];
// What is handed over throws when the body reads it: a getter, a trap of a proxy. What is no array is refused on entry where an array is declared, before its iterator is asked.
row("a getter that throws on what is handed over", () => table[1]({ get x(): number { throw new RangeError("x"); }, y: 2 }));
row("a proxy whose get trap throws", () => table[1](new Proxy({ x: 1, y: 2 }, { get(): never { throw new SyntaxError("get"); } })));
row("a proxy that is revoked", () => { const r = Proxy.revocable({ x: 1, y: 2 }, {}); r.revoke(); return table[1](r.proxy); });
row("an iterator that throws", () => table[2]({ [Symbol.iterator](): never { throw new EvalError("iterator"); } }));
row("an iterator whose next throws", () => table[2]({ [Symbol.iterator]() { return { next(): never { throw new URIError("next"); } }; } }));
// Only the value itself is tested on entry: an array passes whatever its elements are, an object whatever its fields are. The bodies read none of the elements and fields that do not fit.
row("a list of records, the second is a number", () => table[3]([{ x: 1, y: 2 }, 5]));
row("a list of records, the last of 300 lacks a field", () => table[3](Array.from({ length: 300 }, (_, i) => i < 299 ? { x: i, y: i } : { x: i })));
row("a list of records, right", () => table[3]([{ x: 1, y: 2 }, { x: 3, y: 4 }]));
row("a record in a record, wrong", () => table[4]({ name: "n", at: { x: 1, y: "two" } }));
row("a record in a record, right", () => table[4]({ name: "n", at: { x: 1, y: 2 } }));
row("a list of lists, one of them a string", () => table[5]([[1], [2, 3], "four"]));
// The entry's frame is the last before a host frame.
row("map", () => ([5] as any[]).map(table[0])[0]);
row("Array.from", () => Array.from({ length: 1 }, table[0] as any)[0]);
row("forEach, kept", () => { let kept: unknown; const f = table[0]; ([5] as any[]).forEach(x => { kept = f(x); }); return kept; });
row("Reflect.apply", () => Reflect.apply(table[0], null, [5]));
row("call", () => table[0].call(null, 5));
row("apply", () => table[0].apply(null, [5]));
row("bound by the engine", () => Function.prototype.bind.call(table[0], null, 5)());
row("then", () => Promise.resolve(5).then(table[0]));
row("then, twice", () => Promise.resolve(5).then(table[0]).catch(() => 6).then(table[0]));
row("a replacer of String.prototype.replace", () => { let kept: unknown; const f = table[0]; "a".replace(/a/, ((m: string) => { kept = f(m); return ""; }) as any); return kept; });
row("a comparator of sort", () => { let kept: unknown; const f = table[0]; [2, 1].sort((a, b) => { kept = f(a); return a - b; }); return kept; });
row("a getter of a property, by Reflect.get", () => Reflect.get(Object.defineProperty({}, "p", { get: table[0] }), "p"));
// The caller's live values after a call that is rejected.
function manyLive(f: any, n: number): string {
    let a = 1, b = 2.5, c = 3, d = 4.5, e = 5, g = 6.5, h = 7, i = 8.5, s = "s", o = { v: 9 }, l = [10], refused = 0;
    for (let k = 0; k < n; k++) {
        const p = f(k & 1 ? [k] : k);
        p.catch(() => { refused++; });
        a += k; b += a * 0.5; c ^= k; d -= 0.25; e += c & 3; g *= 1.0001; h += l.length; i += o.v; s = s.length < 8 ? s + "x" : "s"; o.v = (o.v + 1) % 11; l[0] = k;
    }
    return [a, b, c, d, e, g.toFixed(6), h, i, s, o.v, l[0]].join(" ");
}
row("twelve things in the caller's hands over 2000 calls, half of them refused", () => Promise.resolve(manyLive(table[0], 2000)));
// The innermost.
async function outer(f: any, x: unknown): Promise<string> { const p = f(x); return p.then(() => "inner fulfilled", (e: any) => "inner rejected " + e.constructor.name); }
row("an async function calls one that refuses: the inner promise, not the outer", () => outer(table[0], 5));
row("under a try of the caller", () => { const f = table[0]; try { return f(5); } catch { return Promise.resolve("CAUGHT AT THE CALL"); } });
row("deep: refused under 200 frames", () => { const f = table[0]; function down(n: number): unknown { return n ? down(n - 1) : f(5); } return down(200); });
row("too deep, through a value", () => table[6](table[6], 0));
row("and the program goes on behind it", () => table[0]([1, 2, 3]));
Promise.all(lines).then(all => { for (const line of all) console.log(line); console.log("the end"); });
export {};
