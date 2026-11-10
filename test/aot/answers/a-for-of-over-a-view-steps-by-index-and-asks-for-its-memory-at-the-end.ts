// answers: with-library
// # `for (const x of view)` has a second copy whose step is the length and the byte. The end of the view asks for its memory, as next() does. f1 = sum
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = IsPristine {{*}}builtinClass=Uint8Array
// # FORM: = GetTypedArrayElement {{*}}isInsideView
// # RUN: run-in-shell $SHELL
// # CHECK: 30 of 30 of 30
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sum(v: Uint8Array): number { let s = 0; for (const x of v) s += x; return s; }
function detached(v: Uint8Array, cut: number): string { let s = 0, n = 0; try { for (const b of v) { s += b; if (++n === cut) structuredClone(v.buffer, { transfer: [v.buffer as ArrayBuffer] }); } return "end" + s; } catch (e) { return (e as Error).name + s + n; } }
function bare(v: Uint8Array, cut: number): number { let s = 0, n = 0; for (const b of v) { s += b; if (++n === cut) structuredClone(v.buffer, { transfer: [v.buffer as ArrayBuffer] }); } return s; }
function tell(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).name; } }
function grown(v: Uint8Array, r: any): string { let s = "", n = 0; for (const x of v) { s += x + 1; if (n++ < 3) r.resize(r.byteLength + 1); } return s; }
function shrunk(v: Uint8Array, r: any): string { let s = "", n = 0; try { for (const x of v) { s += x + 1; if (++n === 2) r.resize(1); } return s; } catch (e) { return s + (e as Error).name; } }
function copied(v: Uint8Array): string { const out: number[] = []; for (const x of v) out.push(x); return out.join(); }
function hashed(v: Uint8Array, t: ArrayLike<number>): number { let c = -1; for (const x of v) c = t[(c ^ x) & 3]! ^ (c >>> 8); return c; }
function nested(u: Uint8Array, v: Uint8Array): number { let s = 0; for (const a of u) for (const b of v) s += a * b; return s; }
function broken(v: Uint8Array): number { let n = 0; for (const x of v) { if (x === 2) break; n = x; } return n; }
function thrown(v: Uint8Array): number { let n = 0; for (const x of v) { try { if (x === 2) throw x; n++; } catch (e) { n += e as number; } } return n; }
function text(v: Uint8Array): string { let t = ""; for (const x of v) t += x; return t; }
function continued(u: Uint8Array, v: Uint8Array): number { let s = 0; out: for (const a of u) for (const b of v) { if (b > a) continue out; s += b; } return s; }
function kinds(v: Float64Array): string { let s = ""; for (const x of v) s += (Object.is(x, -0) ? "-0" : x) + ","; return s; }
function big(v: BigInt64Array): string { let s = 0n; for (const x of v) s += x; return String(s); }
function* given(v: Uint8Array): Generator<number> { for (const x of v) yield x + 1; }
function written(v: Uint8Array): string { let s = "", i = 0; for (const x of v) { s += x + ","; if (i < 3) v[++i] = 9; } return s; }
const three = () => Uint8Array.of(1, 2, 3), resizable = (n: number): any => new (ArrayBuffer as any)(n, { maxByteLength: 8 });
for (const cut of [9, 2, 3, 1]) report(detached(three(), cut));
report(tell(() => bare(three(), 9))); report(tell(() => bare(Uint8Array.of(1, 2), 9))); report(tell(() => bare(three(), 1))); report(tell(() => bare(three(), 3)));
const a = resizable(2), b = resizable(4), c = resizable(4); report(grown(new Uint8Array(a), a)); report(shrunk(new Uint8Array(b), b)); report(shrunk(new Uint8Array(c, 0, 4), c));
report(copied(three())); report(hashed(Uint8Array.of(1, 2), Int32Array.of(5, 6, 7, 8))); report(hashed(Uint8Array.of(1, 2), [5, 6, 7, 8])); report(hashed(Uint8Array.of(1, 2), [5, 6]));
report(nested(Uint8Array.of(1, 2), Uint8Array.of(1, 2))); const same = three(); report(nested(same, same)); report(broken(three())); report(thrown(Uint8Array.of(1, 2))); report(text(Uint8Array.of(1, 2, 3, 4))); report(continued(three(), three()));
report(kinds(Float64Array.of(NaN, -0, 1.5))); report(big(BigInt64Array.of(1n, 2n))); report(sum(new Uint8Array(0)));
const own: any = Uint8Array.of(1, 2); own[Symbol.iterator] = function* () { yield 50; }; report(sum(own)); class Odd extends Uint8Array { *[Symbol.iterator](): any { yield 100; } } report(sum(new Odd(3)));
const moved: any = Uint8Array.of(1); Object.setPrototypeOf(moved, { __proto__: Uint8Array.prototype, *[Symbol.iterator]() { yield 7; } }); report(sum(moved));
report([...given(Uint8Array.of(1, 2))].join()); report(written(three())); report("end");
