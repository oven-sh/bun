// Loops that store one constant into every element, with something in front of them or around them that leaves compiled code: an allocation, a call of a built-in, a collection, a text that is built.
// What is stored does not depend on what ran in between.
function bytes(length: number): Uint8Array {
  const view = new Uint8Array(length);
  for (let k = 0; k < view.length; k++) view[k] = 7;
  return view;
}
function shorts(length: number): Int16Array {
  const view = new Int16Array(length);
  for (let k = 0; k < view.length; k++) view[k] = -300;
  return view;
}
function words(length: number): Int32Array {
  const view = new Int32Array(length);
  for (let k = 0; k < view.length; k++) view[k] = 0x01020304;
  return view;
}
function singles(length: number): Float32Array {
  const view = new Float32Array(length);
  for (let k = 0; k < view.length; k++) view[k] = 1.5;
  return view;
}
function doubles(length: number): Float64Array {
  const view = new Float64Array(length);
  for (let k = 0; k < view.length; k++) view[k] = 0.1;
  return view;
}
function list(length: number): number[] {
  return new Array<number>(length).fill(7);
}
function fractions(length: number): number[] {
  return new Array<number>(length).fill(0.25);
}
function added(view: Int32Array, rounds: number): string {
  let text = "";
  for (let round = 0; round < rounds; round++) {
    text += String(round) + [round, text.length].join("-");
    for (let k = 0; k < view.length; k++) view[k] = (view[k]! + 0x00010001) | 0;
    if (round % 7 === 3) Bun.gc(true);
  }
  return text.length + ":" + view.join();
}
function scaled(view: Float64Array, rounds: number): string {
  const kept: object[] = [];
  for (let round = 0; round < rounds; round++) {
    kept.push({ round, name: "n" + round });
    for (let k = 0; k < view.length; k++) view[k] = view[k]! * 1.0625;
  }
  return kept.length + ":" + view.join();
}

let sum = 0;
function take(values: ArrayLike<number>): void {
  for (let k = 0; k < values.length; k++) sum = (Math.imul(sum, 31) + Math.round(values[k]! * 16)) | 0;
}
for (let round = 0; round < 300; round++) {
  const length = round % 71;
  take(bytes(length));
  take(shorts(length));
  take(words(length));
  take(singles(length));
  take(doubles(length));
  take(list(length));
  take(fractions(length));
  if (round % 50 === 49) Bun.gc(true);
}
console.log(sum);
console.log(bytes(40).join(), shorts(20).join(), words(10).join(), singles(10).join(), doubles(6).join(), list(20).join(), fractions(6).join());
console.log(added(new Int32Array(21), 30));
console.log(scaled(new Float64Array(9).fill(1), 20));
let all: unknown[] = [];
for (let k = 0; k < 9; k++) all = [...all, ...list(20)];
console.log(all.join());
