// A loop walks a view of a resizable buffer and makes a call in every iteration. In one iteration the buffer shrinks, in another round it grows, and the view follows its length.
let mode = 0;
function below(buffer: ArrayBuffer, index: number): number {
  if (index === 2) {
    if (mode === 1) buffer.resize(16);
    else if (mode === 2) buffer.resize(64);
  }
  return 1;
}

function holder(buffer: ArrayBuffer, view: Int32Array): string {
  let text = "";
  for (let index = 0; index < view.length; index++) {
    text += view[index] + ":";
    below(buffer, index);
    text += view[view.length - 1] + " ";
  }
  return text + view.length;
}

for (let round = 0; round < 300; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const buffer = new ArrayBuffer(32, { maxByteLength: 64 });
  const view = new Int32Array(buffer);
  for (let index = 0; index < view.length; index++) view[index] = round + index;
  const line = holder(buffer, view);
  if (mode || round === 0) console.log(round + ": " + line);
}
