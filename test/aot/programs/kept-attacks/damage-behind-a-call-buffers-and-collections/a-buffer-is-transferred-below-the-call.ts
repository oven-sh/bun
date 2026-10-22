// A typed function reads elements of a Float64Array and of a Uint8Array, makes a call and reads them again. Below the call the buffer is transferred away, so the views are detached and have no elements.
let strikes = false;
function below(buffer: ArrayBuffer): number {
  if (strikes) buffer.transfer();
  return 1;
}

function holder(buffer: ArrayBuffer, view: Float64Array, bytes: Uint8Array): string {
  const before = view[1] + bytes[0] + view.length;
  const got = below(buffer);
  let sum = 0;
  for (let index = 0; index < view.length; index++) sum += view[index];
  view[1] = 9;
  return before + " " + got + " " + sum + " " + view[1] + " " + bytes[0] + " " + view.length + " " + bytes.byteLength;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const buffer = new ArrayBuffer(32);
  const view = new Float64Array(buffer);
  view.set([round, 1.5, 2.5, 3.5]);
  const line = holder(buffer, view, new Uint8Array(buffer, 8));
  if (strikes || round === 0) console.log(round + ": " + line);
}
