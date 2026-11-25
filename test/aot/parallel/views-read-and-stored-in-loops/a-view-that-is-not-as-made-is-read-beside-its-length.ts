// after the unit's own witness what-a-turn-has-done-is-not-done-again.ts (calls()): the turn has called somebody, so it may not begin again
const unseen = <T,>(x: T): T => [x][JSON.parse("0")]!;
let heard = 0;
const each: (i: number) => void = unseen((i: number) => { heard += i });
function scaled(view: Int32Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { each(i); sum = (sum + view[i]! * view.length) | 0 } return sum }
function bytes(view: Uint8Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { each(i); sum = (sum + view[i]! * view.length) | 0 } return sum }
function stored(view: Int32Array, n: number): number { for (let i = 0; i < n; i++) { each(i); view[i] = view[i]! * view.length } return n }
function mean(view: Uint8Array): number { let sum = 0; for (let i = 0; i < view.length; i++) sum += view[i]! / view.length; return sum }
(globalThis as any).kit = { scaled, bytes, stored, mean };
const kit = (globalThis as any).kit;
const asMade = () => new Int32Array([1, 2, 3]);
const ownLength = () => Object.defineProperty(new Int32Array([1, 2, 3]), "length", { value: 3 });
const below = () => Object.setPrototypeOf(new Int32Array([1, 2, 3]), Object.create(Int32Array.prototype));
const after = (view: Int32Array) => { kit.stored(view, 3); return view[0] + "," + view[1] + "," + view[2] };
for (let round = 0; round < 2; round++) {
  console.log("scaled", kit.scaled(asMade(), 3), kit.scaled(ownLength(), 3), kit.scaled(below(), 3));
  console.log("bytes", kit.bytes(new Uint8Array([1, 2, 3]), 3), kit.bytes(Buffer.from([1, 2, 3]), 3));
  console.log("stored", after(asMade()), after(ownLength()), after(below()));
  console.log("mean", kit.mean(new Uint8Array([3, 6, 9])), kit.mean(Buffer.from([3, 6, 9])));
}
console.log(heard);
