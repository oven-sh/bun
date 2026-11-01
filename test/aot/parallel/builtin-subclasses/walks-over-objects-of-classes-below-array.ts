class Walk extends Array<number> {
  all(): string { const seen: unknown[] = []; for (const v of this) seen.push(v); return seen.join(); }
  grows(): string { const seen: unknown[] = []; for (const v of this) { seen.push(v); if (this.length < 6) this.push(v * 10); } return seen.join(); }
  shrinks(): string { const seen: unknown[] = []; for (const v of this) { seen.push(v); this.length = Math.max(1, this.length - 1); } return seen.join(); }
  leaves(): number { for (const v of this) if (v > 1) return v; return -1; }
  throws(): string { try { for (const v of this) if (v > 1) throw new Error("at " + v); } catch (e) { return (e as Error).message; } return "none"; }
  pattern(): string { const [a, b = 7, , d, ...rest] = this; return [a, b, d, rest.length, rest.constructor.name].join(); }
  spread(): string { return [0, ...this, 9].join(); }
  *passes(): Generator<number> { yield* this; }
  nested(): number { let n = 0; for (const a of this) for (const b of this) n += a * b; return n; }
  swaps(): string { const seen: unknown[] = []; for (const v of this) { seen.push(v); (Walk.prototype as any)[Symbol.iterator] = function* () { yield -1; }; } return seen.join(); }
  args(): number { return Math.max(...this); }
}
function make(...items: number[]): Walk { const w = new Walk(); for (const item of items) w.push(item); return w; }
function outside(w: Walk): string { const seen: unknown[] = []; for (const v of w) seen.push(v); for (const [i, v] of w.entries()) seen.push(i + ":" + v); for (const k of w.keys()) seen.push(k); return seen.join(); }
function untyped(w: any): string { const seen: unknown[] = []; for (const v of w) seen.push(v); return seen.join(); }
for (let turn = 0; turn < 3; turn++) {
  console.log(make(1, 2, 3).all(), make().all(), make(1.5, NaN, -0, 2 ** 40).all(), make(1, 2).grows(), make(1, 2, 3, 4).shrinks(), make(1, 2, 3).leaves(), make(1, 2, 3).throws());
  console.log(make(1, 2, 3, 4, 5, 6).pattern(), make(1).pattern(), make(1, 2).spread(), [...make(1, 2).passes()].join(), make(1, 2, 3).nested(), make(3, 9, 4).args());
  console.log(outside(make(4, 5)), untyped(make(4, 5)), untyped([4, 5]), untyped("ab"), untyped(new Set([1])), Array.from(make(1, 2)).join(), new Set(make(1, 1, 2)).size, new Map([make(1, 2) as any]).get(1));
  const holes = new Walk(3); holes[1] = 5; console.log(holes.all(), holes.pattern(), holes.spread(), untyped(holes));
  const liar = make(1, 2); (liar as any)[1] = "two"; (liar as any).push(undefined, null, { a: 1 }); console.log(liar.all(), liar.spread(), untyped(liar));
  const frozen = Object.freeze(make(1, 2, 3)); console.log(frozen.all(), frozen.nested(), outside(frozen));
  const sealed = Object.seal(make(1, 2, 3)); console.log(sealed.all(), sealed.nested());
  const own = make(1, 2); (own as any)[Symbol.iterator] = function* () { yield 42; }; console.log(own.all(), own.spread(), own.pattern(), untyped(own));
  const getter = make(1, 2, 3); Object.defineProperty(getter, 1, { get() { getter.length = 2; return 77; } }); console.log(getter.all(), getter.length);
}
console.log(make(1, 2, 3).swaps(), make(1, 2, 3).all(), make(1, 2).spread(), untyped(make(1, 2)));
delete (Walk.prototype as any)[Symbol.iterator];
console.log(make(1, 2, 3).all(), make(1, 2).spread(), untyped(make(1, 2)));
Object.defineProperty(Walk.prototype, Symbol.iterator, { get() { console.log("read"); return Array.prototype.values; }, configurable: true });
console.log(make(1, 2, 3).all(), make(1, 2).spread(), make(1, 2).pattern());
Object.defineProperty(Walk.prototype, Symbol.iterator, { get() { console.log("read keys"); return Array.prototype.keys; }, configurable: true });
console.log(make(5, 6, 7).all(), make(5, 6).spread(), make(5, 6).pattern());
Object.defineProperty(Walk.prototype, Symbol.iterator, { value: 5, configurable: true });
try { console.log(make(1).all()); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
