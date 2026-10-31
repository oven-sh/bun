// Values typed T[] or Uint8Array that do not iterate as a plain array does: a subclass with an iterator of its own, an array that has one as an own property, a subclass that overrides entries(). for-of, spread, destructuring and loops over entries() take the generic path and print what plain Bun prints.
const trace: string[] = [];
class Quiet<T> extends Array<T> {} class Backwards<T> extends Array<T> {} class Closable<T> extends Array<T> {} class Renumbered<T> extends Array<T> {}
class Bytes extends Uint8Array {} class BytesBackwards extends Uint8Array {}
(Backwards.prototype as any)[Symbol.iterator] = function* (this: unknown[]) { trace.push("backwards"); for (let i = this.length; i--;) yield this[i]; };
(Closable.prototype as any)[Symbol.iterator] = function (this: unknown[]) { let i = 0; return { next: () => (i < this.length ? { done: false, value: this[i++] } : { done: true, value: undefined }), return: () => { trace.push("closed at " + i); return {}; } }; };
(Renumbered.prototype as any).entries = function* (this: unknown[]) { trace.push("entries"); for (let i = 0; i < this.length; i++) yield [i + 100, this[i]]; };
(BytesBackwards.prototype as any)[Symbol.iterator] = function* (this: Uint8Array) { trace.push("bytes backwards"); for (let i = this.length; i--;) yield this[i]; };
function filled<L extends number[]>(list: L): L { list.push(1, 2, 3, 4); return list; }
function withOwnIterator(): number[] { const list = [1, 2, 3, 4]; (list as any)[Symbol.iterator] = function* () { trace.push("own"); yield 40; yield 30; }; return list; }
function joined(xs: number[]): string { let s = ""; for (const x of xs) s += x + ";"; return s; }
function firstOver(xs: number[], limit: number): number { for (const x of xs) if (x > limit) return x; return -1; }
function spread(xs: number[]): string { return [0, ...xs, 9].join(); } function largest(xs: number[]): number { return Math.max(...xs); }
function firstTwo(xs: number[]): string { const [a, b] = xs; return a + "," + b; }
function headAndRest(xs: number[]): string { const [head, ...rest] = xs; return head + "|" + rest.join() + "|" + Array.isArray(rest); }
function numbered(xs: number[]): string { let s = ""; for (const [i, x] of xs.entries()) s += i + "=" + x + ";"; return s; }
function indexed(xs: number[]): string { let s = ""; for (let i = 0; i < xs.length; i++) s += xs[i] + ";"; return s; }
function joinedBytes(xs: Uint8Array): string { let s = ""; for (const x of xs) s += x + ";"; return s; } function spreadBytes(xs: Uint8Array): string { const [a, b] = xs; return [...xs].join() + "|" + a + "," + b; }
function report(label: string, xs: number[]): void { let previous = ""; for (let round = 0; round < 100; round++) { trace.length = 0; const output = [joined(xs), firstOver(xs, 1), spread(xs), largest(xs), firstTwo(xs), headAndRest(xs), numbered(xs), indexed(xs)].join(" ") + " [" + trace.join() + "]"; if (output !== previous) console.log(label + ": " + output); previous = output; } }
function reportBytes(label: string, xs: Uint8Array): void { trace.length = 0; console.log(label + ": " + joinedBytes(xs) + " " + spreadBytes(xs) + " [" + trace.join() + "]"); }
report("array", [1, 2, 3, 4]); report("quiet", filled(new Quiet<number>())); report("backwards", filled(new Backwards<number>())); report("closable", filled(new Closable<number>())); report("renumbered", filled(new Renumbered<number>()));
report("own iterator", withOwnIterator()); report("empty", []); report("empty backwards", new Backwards<number>()); report("array again", [5, 6]);
reportBytes("bytes", Uint8Array.of(1, 2, 3)); reportBytes("subclass", Bytes.of(1, 2, 3)); reportBytes("bytes backwards", BytesBackwards.of(1, 2, 3)); reportBytes("no bytes", new Uint8Array(0)); reportBytes("no bytes backwards", new BytesBackwards(0)); reportBytes("bytes again", Uint8Array.of(4, 5));
export {};
