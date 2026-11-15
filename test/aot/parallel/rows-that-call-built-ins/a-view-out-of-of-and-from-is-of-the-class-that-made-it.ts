class Longer extends Uint32Array { get length() { return 9; } }
class Odd { get length() { return 7; } get [Symbol.toStringTag]() { return "Odd"; } }
function size(view: { length: number }): number { return view.length; }
function head(view: Uint32Array): number { return view[0]! + view.length; }
function bytes(view: Uint8Array): string { return view.join() + " " + view.BYTES_PER_ELEMENT + " " + Object.prototype.toString.call(view); }
function ofOdd(view: Uint32Array): string { return view.length + " " + view[0] + " " + (view instanceof Uint32Array) + " " + typeof view.join; }
function ofBelow(view: Uint32Array): string { return view.length + " " + view[0] + " " + (view instanceof Uint32Array) + " " + typeof view.join; }
const from = (C: any, items: unknown) => C.from(items);
const of = (C: any, ...items: number[]) => C.of(...items);
console.log(head(Uint32Array.of(4000000000, 2)), head(Uint32Array.from([1, 2, 3])), bytes(Uint8Array.of(300, 1)), bytes(Uint8Array.from("123")));
console.log(size(from(Uint32Array, [1, 2])), size(from(Longer, [1, 2])), size(of(Uint32Array, 1, 2, 3)), size(of(Longer, 1)));
console.log(bytes(Uint32Array.of.call(Uint8Array, 300, 2) as unknown as Uint8Array), bytes(Uint32Array.from.call(Uint8Array, [257]) as unknown as Uint8Array));
const plain = Reflect.construct(Uint32Array, [2]) as Uint32Array;
const odd = Reflect.construct(Uint32Array, [2], Odd) as Uint32Array;
const below = Reflect.construct(Uint32Array, [2], Longer) as Uint32Array;
console.log(size(plain), size(odd), size(below), Object.prototype.toString.call(plain), Object.prototype.toString.call(odd), odd instanceof Uint32Array, below instanceof Longer, plain instanceof Uint32Array);
console.log(ofOdd(Reflect.construct(Uint32Array, [2], Odd) as Uint32Array), ofBelow(Reflect.construct(Uint32Array, [2], Longer) as Uint32Array));
for (const wrong of [Array, Object, Map, function () {}, Object.getPrototypeOf(Uint8Array)]) {
  try { console.log(String(of(wrong, 1, 2))); } catch (error) { console.log((error as Error).constructor.name); }
}
const kept = Uint16Array.of(1, 2, 3);
Object.setPrototypeOf(kept, Odd.prototype);
console.log(size(kept), Object.prototype.toString.call(kept));
