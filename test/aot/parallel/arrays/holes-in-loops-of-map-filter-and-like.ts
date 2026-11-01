// `k in array` skips a hole in the loops of map, filter, forEach, some, every, reduce and their like. The arm of the hole is a slow path of the compiled loop: arrays that are all holes, half holes or get their holes while the loop runs give what plain Bun gives, and so do prototypes that fill a hole.
const launder = new Function("v", "return v") as <V>(v: V) => V;
function show(what: string, f: () => unknown) { let last: unknown; for (let round = 0; round < 300; round++) last = f(); console.log(what, JSON.stringify(last, (_, v) => (v === undefined ? "undefined" : v))); }
function list(a: unknown[]): unknown[] { const seen: unknown[] = []; for (let i = 0; i < a.length; i++) seen.push(i in a ? a[i] : "hole"); return [a.length, seen]; }
function sparse(n: number, step: number): number[] { const a: number[] = new Array(n); for (let i = 0; i < n; i += step) a[i] = i; return a; }
function punched(n: number, at: number): string[] { const a: string[] = []; for (let i = 0; i < n; i++) a.push("s" + i); delete a[at]; return a; }

for (const step of [1, 2, 3, 100]) {
  show("map " + step, () => list(sparse(7, step).map((v) => v + 1)));
  show("map into objects " + step, () => list(sparse(7, step).map((v) => ({ v }))));
  show("filter " + step, () => list(sparse(7, step).filter((v) => v >= 0)));
  show("forEach " + step, () => { const seen: number[] = []; sparse(7, step).forEach((v, i) => seen.push(v, i)); return seen; });
  show("some " + step, () => { let calls = 0; const found = sparse(7, step).some((v) => (calls++, v > 100)); return [found, calls]; });
  show("every " + step, () => { let calls = 0; const all = sparse(7, step).every((v) => (calls++, v >= 0)); return [all, calls]; });
  show("reduce " + step, () => sparse(7, step).reduce((sum, v, i) => sum + v * 10 + i, 0));
  show("reduceRight " + step, () => sparse(7, step).reduceRight((text, v) => text + v, ""));
  show("indexOf " + step, () => [sparse(7, step).indexOf(undefined as never), sparse(7, step).lastIndexOf(6), sparse(7, step).includes(undefined as never)]);
  show("find sees holes " + step, () => { let calls = 0; sparse(7, step).find(() => (calls++, false)); return calls; });
  show("flatMap " + step, () => list(sparse(7, step).flatMap((v) => [v, v])));
}
show("no element at all", () => { let calls = 0; const a: number[] = new Array(5); return [list(a.map(() => calls++)), list(a.filter(() => (calls++, true))), calls]; });
show("a deleted text", () => list(punched(5, 2).map((s) => s + "!")));
show("the first is deleted", () => list(punched(5, 0).map((s) => s.length)));
show("the last is deleted", () => list(punched(5, 4).filter(() => true)));
show("the callback deletes what is ahead", () => { const a = punched(6, 1); const seen: string[] = []; a.forEach((s, i) => { seen.push(s); delete a[i + 2]; }); return seen; });
show("the callback fills the hole ahead", () => { const a = sparse(6, 2); return list(a.map((v, i) => { a[i + 1] = 100 + i; return v; })); });
show("the callback makes the array sparse", () => { const a = sparse(4, 1); const seen: number[] = []; a.forEach((v) => { seen.push(v); a[50000] = 1; }); return [seen, a.length]; });
show("an array from outside", () => list(launder(sparse(6, 2)).map((v) => v * 2)));
show("in, by hand", () => { const a = sparse(8, 3); let present = 0, absent = 0; for (let i = 0; i < a.length; i++) { if (i in a) present += a[i]; else absent++; } return [present, absent]; });
show("in, by hand, nothing else", () => { const a = sparse(8, 3); let present = 0; for (let i = 0; i < a.length; i++) { if (i in a) present += a[i]; } return present; });
show("in, beyond the length and below zero", () => { const a = sparse(3, 1); return [3 in a, -1 in a, 1.5 in a, 2 in a, "1" in a, "length" in a]; });
class Inherits extends Array<number> {}
Object.defineProperty(Inherits.prototype, 1, { value: "from the prototype", configurable: true, writable: true });
show("a prototype fills the hole", () => { const a = new Inherits(3); a[0] = 0; a[2] = 2; return [list(Array.prototype.map.call(a, (v) => v)), 1 in a, a[1]]; });
