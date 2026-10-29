// The first cut of a Buffer is a Buffer and the first cut of a Uint8Array is a Uint8Array, so the second cut has a receiver of one of two classes.
// Flags: --aot-check=verify-each-pass
function cutTwice(view: Uint8Array): string {
  const part = view.subarray(view.length - 8, -2).subarray(1);
  return part.constructor.name + " " + part.length + " " + part.byteOffset + " " + Array.from(part).join();
}
let view: any = new Uint8Array(new ArrayBuffer(64, { maxByteLength: 136 }));
for (let step = 0; step < 8; step++) {
  for (let index = 0; index < view.length; index++) view[index] = index + step;
  console.log(step, cutTwice(view));
  if (step === 2) view = Buffer.alloc(32);
  if (step === 5) view = new Uint8Array(16);
}
