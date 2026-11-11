const unseen = <T,>(x: T): T => [x][JSON.parse("0")]!;
let heard = 0; const each: (i: number) => void = unseen((i: number) => { heard += i });
function offsets(view: Uint8Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { each(i); sum = (sum + view[i]! * (view.byteOffset + 1)) | 0 } return sum }
function lengths(view: Uint8Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { each(i); sum = (sum + view[i]! * view.byteLength) | 0 } return sum }
(globalThis as any).kit = { offsets, lengths }; const kit = (globalThis as any).kit;
for (let round = 0; round < 2; round++) console.log(kit.offsets(new Uint8Array([1, 2, 3]), 3), kit.offsets(Buffer.from([1, 2, 3]).subarray(0), 3) > 0, kit.lengths(new Uint8Array([1, 2, 3]), 3), kit.lengths(Buffer.from([1, 2, 3]), 3));
console.log(heard);
