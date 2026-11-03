// `new Array(n)` has its length from the start and holes for elements. The loop that fills it stores inside that length, whatever the elements are, and everything else that a program may do to such an array in between is seen.
const launder = new Function("v", "return v") as <V>(v: V) => V;
function show(what: string, f: () => unknown) { let last: unknown; for (let round = 0; round < 300; round++) last = f(); console.log(what, JSON.stringify(last, (_, v) => (Object.is(v, -0) ? "-0" : typeof v === "number" && v !== v ? "NaN" : v === undefined ? "undefined" : v))); }
function list(a: unknown[]): unknown[] { const seen: unknown[] = []; for (let i = 0; i < a.length; i++) seen.push(i in a ? a[i] : "hole"); return [a.length, seen]; }

function ints(n: number): number[] { const a: number[] = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }
function halves(n: number): number[] { const a: number[] = new Array(n); for (let i = 0; i < n; i++) a[i] = i / 2; return a; }
function large(n: number): number[] { const a: number[] = new Array(n); for (let i = 0; i < n; i++) a[i] = i * 3000000000; return a; }
function texts(n: number): string[] { const a: string[] = new Array(n); for (let i = 0; i < n; i++) a[i] = "t" + i; return a; }
function objects(n: number): { at: number }[] { const a: { at: number }[] = new Array(n); for (let i = 0; i < n; i++) a[i] = { at: i }; return a; }
function mixed(n: number): (number | string)[] { const a: (number | string)[] = new Array(n); for (let i = 0; i < n; i++) a[i] = i & 1 ? "odd" : i; return a; }
for (const n of [0, 1, 2, 7]) {
  show("ints " + n, () => list(ints(n)));
  show("halves " + n, () => list(halves(n)));
  show("large " + n, () => list(large(n)));
  show("texts " + n, () => list(texts(n)));
  show("objects " + n, () => list(objects(n)));
  show("mixed " + n, () => list(mixed(n)));
}

show("every other one stays a hole", () => { const a: number[] = new Array(6); for (let i = 0; i < 6; i += 2) a[i] = i; return [list(a), a[1], a[5], 1 in a, a.indexOf(undefined as never), a.includes(undefined as never)]; });
show("holes of numbers are read", () => { const a: number[] = new Array(4); a[2] = 1.5; let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] ?? 100; return [sum, a[0] === undefined, a[2]]; });
show("-0 and NaN are kept", () => { const a: number[] = new Array(4); for (let i = 0; i < 4; i++) a[i] = i === 1 ? -0 : i === 2 ? NaN : i; return list(a); });
show("undefined among numbers", () => { const a: number[] = new Array(3); for (let i = 0; i < 3; i++) a[i] = i === 1 ? launder<number>(undefined as never) : i; return [list(a), 1 in a]; });
show("a text among numbers", () => { const a: number[] = new Array(3); for (let i = 0; i < 3; i++) a[i] = i === 2 ? launder<number>("two" as never) : i + 0.5; return list(a); });
show("filled from the end", () => { const a: number[] = new Array(5); for (let i = 4; i >= 0; i--) a[i] = i * i; return list(a); });
show("one beyond the length", () => { const n = 3; const a: number[] = new Array(n); for (let i = 0; i <= n; i++) a[i] = i; return list(a); });
show("twice the length", () => { const n = 3; const a: number[] = new Array(n); for (let i = 0; i < 2 * n; i++) a[i] = i; return list(a); });
show("the length is cut inside the loop", () => { const n = 6; const a: number[] = new Array(n); for (let i = 0; i < n; i++) { if (i === 3) a.length = 2; a[i] = i; } return list(a); });
show("the length grows inside the loop", () => { const n = 4; const a: number[] = new Array(n); for (let i = 0; i < n; i++) { if (i === 1) a.length = 9; a[i] = i; } return list(a); });
show("a push inside the loop", () => { const n = 4; const a: number[] = new Array(n); for (let i = 0; i < n; i++) { if (i === 2) a.push(99); a[i] = i; } return list(a); });
show("frozen inside the loop", () => { "use strict"; const n = 4; const a: number[] = new Array(n); let thrown = 0; for (let i = 0; i < n; i++) { if (i === 2) Object.freeze(a); try { a[i] = i; } catch { thrown++; } } return [list(a), thrown]; });
show("a getter inside the length", () => { const n = 4; const a: number[] = new Array(n); let stored = 0; Object.defineProperty(a, 2, { get() { return "got"; }, set() { stored++; }, configurable: true }); for (let i = 0; i < n; i++) a[i] = i; return [a[0], a[1], a[2], a[3], stored]; });
show("two names for one array", () => { const n = 4; const a: number[] = new Array(n); const b = launder(a); for (let i = 0; i < n; i++) { a[i] = i; if (i === 1) b.length = 0; } return list(a); });
show("the other array is the same array", () => { const n = 4; const a: number[] = new Array(n); const from = launder(a); a[0] = 7; for (let i = 1; i < n; i++) a[i] = from[i - 1] + 1; return list(a); });
show("a length that is no integer", () => { try { return new Array(launder(1.5)).length; } catch (e) { return (e as Error).constructor.name; } });
show("a negative length", () => { try { return new Array(launder(-1)).length; } catch (e) { return (e as Error).constructor.name; } });
show("a length that is a text", () => list(new Array(launder<number>("3" as never))));
show("a very long array", () => { const a: number[] = new Array(launder(4000000000)); a[0] = 1; a[3999999999] = 2; return [a.length, a[0], a[1], a[3999999999]]; });
show("long enough for a loop of strips", () => { const n = 70000; const a: number[] = new Array(n); for (let i = 0; i < n; i++) a[i] = i; let sum = 0; for (let i = 0; i < n; i++) sum += a[i]; return [a.length, sum]; });

show("map into objects", () => list(ints(5).map((v) => ({ v }))));
show("map into halves", () => list(ints(5).map((v) => v / 2)));
show("map over holes", () => { const a: number[] = new Array(5); a[1] = 1; a[3] = 3; return list(a.map((v) => v * 2)); });
show("map whose callback cuts the source", () => { const a = ints(6); return list(a.map((v, i) => { if (i === 2) a.length = 3; return v; })); });
show("map whose callback lengthens the source", () => { const a = ints(3); return list(a.map((v) => { a.push(v); return v; })); });
show("map whose callback returns other things", () => list(ints(4).map((v) => (v === 2 ? "two" : v === 3 ? undefined : v))));
show("a copy by index", () => { const from = halves(5); const to: number[] = new Array(from.length); for (let i = 0; i < from.length; i++) to[i] = from[i]; return list(to); });
show("Array(n) without new", () => { const a: number[] = Array(3); for (let i = 0; i < 3; i++) a[i] = i + 0.25; return list(a); });
