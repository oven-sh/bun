// Guards: a typed array over a buffer that may be resized goes through the typed versions of loops, and what they know of its length ends where the buffer is resized.
type Bytes = Uint8Array | Int32Array | Float64Array;
function sum(view: Uint8Array): number { let total = 0; for (let i = 0; i < view.length; i++) total += view[i]; return total; }
function fill(view: Uint8Array, base: number): number { for (let i = 0; i < view.length; i++) view[i] = (i + base) & 255; return view.length; }
function sumOfWords(view: Int32Array): number { let total = 0; for (let i = 0; i < view.length; i++) total += view[i]; return total; }
function sumOfNumbers(view: Float64Array): number { let total = 0; for (let i = 0; i < view.length; i++) total += view[i] * 2; return total; }
function sumWhileResized(view: Uint8Array, buffer: ArrayBuffer, at: number, to: number): string { let total = 0, turns = 0; for (let i = 0; i < view.length; i++) { total += view[i]; turns++; if (i === at) buffer.resize(to); } return total + " " + turns + " " + view.length; }
function sumToAnOldLength(view: Uint8Array, buffer: ArrayBuffer, at: number, to: number): string { let seen = ""; const end = view.length; for (let i = 0; i < end; i++) { if (i === at) buffer.resize(to); seen += view[i] + ","; } return seen + view.length; }
function storeToAnOldLength(view: Uint8Array, buffer: ArrayBuffer, at: number, to: number): string { const end = view.length; for (let i = 0; i < end; i++) { if (i === at) buffer.resize(to); view[i] = i + 1; } return view.length + ":" + Array.from(new Uint8Array(buffer)).join(); }
function resizedByAGetter(view: Uint8Array, holder: { readonly step: number }): string { let total = 0, turns = 0; for (let i = 0; i < view.length; i += holder.step) { total += view[i]; turns++; } return total + " " + turns; }
function lengthTwice(view: Uint8Array, buffer: ArrayBuffer, to: number): string { const before = view.length; buffer.resize(to); return before + ">" + view.length + ">" + view.byteLength + ">" + view.byteOffset; }
const make = (size: number, most: number) => { const buffer = new ArrayBuffer(size, { maxByteLength: most }); fill(new Uint8Array(buffer), 1); return buffer; };
{
  const buffer = make(16, 64), whole = new Uint8Array(buffer), tail = new Uint8Array(buffer, 4), window = new Uint8Array(buffer, 4, 8);
  console.log(sum(whole), sum(tail), sum(window), whole.length, tail.length, window.length);
  buffer.resize(32); console.log(sum(whole), sum(tail), sum(window), fill(whole, 3), fill(tail, 5), fill(window, 7), sum(whole));
  buffer.resize(8); console.log(sum(whole), sum(tail), sum(window), whole.length, tail.length, window.length, fill(window, 9));
  buffer.resize(2); console.log(sum(whole), sum(tail), sum(window), whole.length, tail.length, window.length, tail.byteOffset, window.byteLength);
  buffer.resize(0); console.log(sum(whole), sum(tail), sum(window), fill(whole, 1), fill(tail, 1));
  buffer.resize(64); console.log(sum(whole), sum(tail), sum(window), whole.length, tail.length, window.length, fill(window, 11), sum(whole));
}
{
  const buffer = make(32, 64), words = new Int32Array(buffer), numbers = new Float64Array(buffer, 8), some = new Int32Array(buffer, 4, 2);
  console.log(sumOfWords(words), sumOfNumbers(numbers) > 0, sumOfWords(some), words.length, numbers.length);
  buffer.resize(30); console.log(sumOfWords(words), words.length, numbers.length, sumOfWords(some));
  buffer.resize(9); console.log(sumOfWords(words), words.length, numbers.length, sumOfNumbers(numbers), sumOfWords(some), some.length);
  buffer.resize(64); console.log(sumOfWords(words), words.length, numbers.length, sumOfWords(some), some.length);
}
for (const [at, to] of [[0, 0], [3, 4], [3, 5], [3, 2], [7, 64], [15, 17], [2, 16]]) {
  let buffer = make(16, 64); console.log("read", at, to, sumWhileResized(new Uint8Array(buffer), buffer, at, to));
  buffer = make(16, 64); console.log("window", at, to, sumWhileResized(new Uint8Array(buffer, 2, 8), buffer, at, to));
  buffer = make(16, 64); console.log("old length", at, to, sumToAnOldLength(new Uint8Array(buffer), buffer, at, to));
  buffer = make(16, 64); console.log("stores", at, to, storeToAnOldLength(new Uint8Array(buffer, 1), buffer, at, to));
  buffer = make(16, 64); console.log("twice", to, lengthTwice(new Uint8Array(buffer, 2), buffer, to));
  buffer = make(16, 64); console.log("twice, a window", to, lengthTwice(new Uint8Array(buffer, 1, 3), buffer, to));
}
{
  const buffer = make(24, 64); let reads = 0;
  console.log(resizedByAGetter(new Uint8Array(buffer), { get step() { if (++reads === 5) buffer.resize(7); return 1; } }));
  const moved = make(24, 64), view = new Uint8Array(moved); const other = moved.transfer(8);
  console.log(sum(view), view.length, fill(view, 1), sum(new Uint8Array(other)), other.resizable, other.byteLength);
}
