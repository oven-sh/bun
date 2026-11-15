// Quotients and remainders of a loop's counter by constants, where the counter is bounded by a view, a list or a string.
const bytes = new Uint8Array(41).map((_, i) => i * 53), words = new Int32Array(17).map((_, i) => Math.imul(i - 8, 0x7ffffff1)), list: number[] = [], string = "abcdefghijklmnopqrstuvwxyz0123456789";
for (let i = 0; i < 33; i++) list.push(i * 977 - 9000);
const show = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));
function byTwenty(view: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < view.length; i++) out.push((i / 20) | 0, i % 20, Math.floor(i / 20), (i / 20) >>> 0, ~~(i / 7), (i / 8) >> 0);
  return out;
}
function place(view: Uint8Array, width: number): number {
  let sum = 0;
  for (let i = 0; i < view.length; i++) sum = (sum * 31 + (i % width) * 7 + ((i / width) | 0)) | 0;
  return sum;
}
function constantWidth(items: readonly number[]): number {
  const width = 20;
  let sum = 0;
  for (let i = 0; i < items.length; i++) sum = (sum * 33 + (i % width) * 5 + ((i / width) | 0)) | 0;
  return sum;
}
function below(view: Int32Array): number[] {
  const out: number[] = [];
  for (let i = view.length - 1; i >= 0; i--) out.push((view[i]! / 3) | 0, (view[i]! / -20) | 0, Math.trunc(view[i]! / 1000), (view[i]! / 65536) & 255, Math.ceil(view[i]! / 7));
  return out;
}
function wide(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(((i * 4294967291) / 10) | 0, ((i * 1000003) / 2147483648) | 0, ((i - 5) / 64) | 0, ((i - 5) / 0) | 0, ((i - 5) % -3) | 0, ((i * 9007199254) / 4294967296) | 0);
  return out;
}
function written(view: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < view.length; i++) sum = (sum + ((i / 20) | 0)) | 0;
  return sum;
}
for (const out of [byTwenty(bytes), below(words), wide(string)]) console.log(out.map(show).join(" "));
console.log(place(bytes, 7), place(bytes, -7), place(bytes, 0), place(bytes, 2.5), constantWidth(list), written(bytes), written(new Uint8Array(0)), written(new Uint8Array(5000)));
export {};
