function text(x: unknown): string { return typeof x + ":" + String(x); }
function has(o: object, k: string): unknown { return Object.prototype.hasOwnProperty.call(o, k); }
function tag(x: unknown): unknown { return Object.prototype.toString.call(x); }
function most(list: number[]): unknown { return Math.max.apply(null, list); }
function cut(list: ArrayLike<number>): unknown { return Array.prototype.slice.call(list, 1); }
function made(C: any, list: unknown[]): unknown { return Reflect.construct(C, list); }
function applied(f: any, self: unknown, list: unknown[]): unknown { return Reflect.apply(f, self, list); }
console.log(text(has({ a: 1 }, "a")), text(has({ a: 1 }, "b")), text(tag([])), text(tag(null)), text(most([1, 5, 3])), text(most([])), text(cut([1, 2, 3])), text(cut({ length: 2, 0: 7, 1: 8 })));
console.log(text((made(Uint32Array, []) as Uint32Array).length), text((made(Uint32Array, [3]) as Uint32Array).length), text((made(Map, []) as Map<unknown, unknown>).size), text((made(Map, [[[1, 2]]]) as Map<unknown, unknown>).size), text((made(Array, [3]) as unknown[]).length), text((made(Array, []) as unknown[]).length), text(made(Date, [0]) instanceof Date), text((made(Set, [[1, 1, 2]]) as Set<unknown>).size));
console.log(text(applied(Math.min, null, [])), text(applied(Math.min, null, [4, 2])), text(applied(String.prototype.toUpperCase, "ab", [])), text(applied(Array.prototype.indexOf, [1, 2], [2])), text(applied(parseInt, null, ["12px"])), text(applied(Number, null, ["x"])), text(applied(Symbol.for, null, ["k"]) === Symbol.for("k")));
console.log(text(Uint32Array.of().length), text(Uint8Array.from([]).length), text(Uint8Array.from({ length: 2 }).join()), text(String.prototype.charAt.call("xyz", 1)), text(Array.prototype.join.call([1, [2, 3]], "-")), text(Number.prototype.toFixed.call(1.255, 2)));
for (const wrong of [() => Math.max.call(null, 1n as unknown as number), () => Reflect.construct(Math.max, []), () => Reflect.apply(Map, null, []), () => Array.prototype.slice.call(null), () => Reflect.construct(Symbol, [])]) {
  try { console.log(text(wrong())); } catch (error) { console.log((error as Error).constructor.name); }
}
const kept = Array.prototype.concat.call([1], [2], 3);
kept.push(4);
console.log(text(kept), text(Array.prototype.map.call("ab", (c: unknown) => c + "!")), text(Function.prototype.call.call(Math.abs, null, -3)), text(Function.prototype.apply.call(Math.pow, null, [2, 5])));
