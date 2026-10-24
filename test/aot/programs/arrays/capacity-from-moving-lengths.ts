// Arrays filled by loops whose bound is the length of something else, where the bound moves, lies or is very large.
function copyCounted(xs: number[]) { const out: number[] = []; for (let i = 0; i < xs.length; i++) out.push(xs[i] * 2); return out; }
function copyForOf(xs: number[]) { const out: number[] = []; for (const x of xs) out.push(x + 1); return out; }
function growsWhileWalked(xs: number[]) { const out: number[] = []; for (const x of xs) { out.push(x); if (x === 3 && xs.length < 9) xs.push(30, 3); } return out; }
function shrinksWhileWalked(xs: number[]) { const out: number[] = []; for (let i = 0; i < xs.length; i++) { out.push(xs[i]); if (i % 2) xs.pop(); } return out; }
function leavesEarly(xs: number[], limit: number) { const out: number[] = []; for (let i = 0; i < xs.length; i++) { if (xs[i] > limit) break; out.push(xs[i]); } return out; }
function throwsInside(xs: number[]) { const out: number[] = []; try { for (const x of xs) { if (x < 0) throw new RangeError("negative"); out.push(x); } } catch (error) { out.push(-1); } return out; }
function fromBytes(bytes: Uint8Array) { const out: number[] = []; for (let i = 0; i < bytes.length; i++) out.push(bytes[i]); return out; }
function fromMap(map: Map<string, number>) { const out: number[] = []; for (let i = 0; i < map.size; i++) out.push(i); for (const [, value] of map) out.push(value); return out; }
function fromAnything(xs: any) { const out: any[] = []; for (let i = 0; i < xs.length; i++) out.push(xs[i]); return out; }
function intoItself(xs: number[]) { let rounds = 0; for (let i = 0; i < xs.length && rounds < 5; i++, rounds++) xs.push(i); return xs; }
function countdown(xs: number[]) { const out: number[] = []; for (let i = xs.length - 1; i >= 0; i--) out.push(xs[i]); return out; }
function literalInLoop(rows: number[][]) { const all: number[][] = []; for (const row of rows) { const out: number[] = [0]; for (let i = 0; i < row.length; i++) out.push(row[i]); all.push(out); } return all; }
class Loud extends Array<number> { pushes = 0; push(...items: number[]) { this.pushes += items.length; return super.push(...items); } }
function intoSubclass(xs: number[]) { const out = new Loud(); for (const x of xs) out.push(x); return [out.length, out.pushes, out[out.length - 1]]; }

const show = (label: string, value: unknown) => console.log(label, JSON.stringify(value));
show("counted", copyCounted([1, 2, 3]));
show("for of", copyForOf([1, 2, 3]));
show("empty", [copyCounted([]), copyForOf([])]);
show("holes", copyForOf([1, , 3] as number[]));
show("grows", growsWhileWalked([1, 3, 5]));
show("shrinks", shrinksWhileWalked([1, 2, 3, 4, 5, 6, 7]));
show("leaves early", leavesEarly([1, 2, 9, 4], 5));
show("throws", throwsInside([1, 2, -3, 4]));
show("bytes", fromBytes(new Uint8Array([7, 8, 9])));
const resizable = new Uint8Array(new ArrayBuffer(4, { maxByteLength: 16 }));
show("resizable", fromBytes(resizable).length);
const detached = new Uint8Array(8); detached.buffer.transfer();
show("detached", fromBytes(detached));
show("map", fromMap(new Map([["a", 5], ["b", 6]])));
show("string", fromAnything("abc"));
show("array-like", fromAnything({ length: 2, 0: "x", 1: "y" }));
show("negative length", fromAnything({ length: -5 }));
show("fraction", fromAnything({ length: 2.5, 0: 1, 1: 2, 2: 3 }));
let reads = 0;
show("getter", [fromAnything({ get length() { return ++reads < 4 ? 10 : 0; }, 0: "a", 1: "b", 2: "c" }), reads]);
show("proxy", fromAnything(new Proxy([1, 2], { get(target, key, receiver) { return key === "length" ? 3 : Reflect.get(target, key, receiver); } })));
show("itself", intoItself([9]));
show("countdown", countdown([1, 2, 3]));
show("rows", literalInLoop([[1], [], [2, 3, 4]]));
show("subclass", intoSubclass([4, 5, 6]));
const large = new Array<number>(300000).fill(1);
show("large", [copyCounted(large).length, copyForOf(large).length]);
const sparse: number[] = []; sparse.length = 4000000;
show("sparse", copyCounted(sparse).length);
