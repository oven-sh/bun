// A step that spreads in its turn, that throws through several spreads, and steps that make much garbage while the list grows.
class Nest { constructor(public depth: number) {} *[Symbol.iterator](): Generator<number> { yield this.depth; if (this.depth) yield* [...new Nest(this.depth - 1)]; } }
console.log([...new Nest(6)].join());
class ByHand { constructor(public depth: number) {} [Symbol.iterator]() { let rest: number[] | undefined; const depth = this.depth; return { next: () => { rest ??= depth ? [depth, ...new ByHand(depth - 1)] : [0]; return rest.length ? { done: false, value: rest.shift() } : { done: true, value: undefined }; } }; } }
console.log([...new ByHand(6)].join());
class Fails { constructor(public depth: number) {} [Symbol.iterator]() { const depth = this.depth; return { next() { if (!depth) throw new RangeError("at the bottom"); return { done: false, value: [...new Fails(depth - 1)] }; } }; } }
try { console.log([...new Fails(5)].length); } catch (error) { console.log(String(error)); }
class Endless { [Symbol.iterator](): Iterator<unknown> { return { next: () => ({ done: false, value: [...new Endless()] }) }; } }
try { console.log([...new Endless()].length); } catch (error) { console.log((error as Error).constructor.name); }
class Garbage { constructor(public limit: number) {} [Symbol.iterator]() { let i = 0; const limit = this.limit; return { next: () => (i < limit ? { done: false, value: { i: i++, filler: new Array(20).fill(i) } } : { done: true, value: undefined }) }; } }
const many = [...new Garbage(60000)];
console.log(many.length, many[0].i, many[59999].i, many[31234].filler.length);
(globalThis as any).held = { it: new Garbage(60000) };
const more: any[] = ["head", ...(globalThis as any).held.it];
console.log(more.length, more[1].i, more[60000].i);
const kinds = [...new (class { *[Symbol.iterator]() { yield 1; yield 2.5; yield "s"; yield undefined; yield -0; yield NaN; yield 10n; yield null; } })()];
console.log(kinds.map(v => Object.is(v, -0) ? "-0" : String(v)).join());
