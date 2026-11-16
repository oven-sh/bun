// A NaN has many spellings in bits: the quiet one, the one with the sign, those with a payload, the signaling ones. Read out of bytes, handed through a function that knows nothing, none equals itself.
function other(x: unknown): boolean {
  return x !== x;
}
function count(list: Float64Array): number {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (x !== x) n++;
  }
  return n;
}
(globalThis as any).kit = { other, count };
const kit = (globalThis as any).kit;
const heads = [0x7ff8, 0xfff8, 0x7ff0, 0xfff0, 0x7ffc, 0xfffc, 0x7fff, 0xffff, 0x7ff4, 0xfff4, 0x7ffa, 0xfffa, 0xfffe, 0x7ffe];
const tails = [0n, 1n, 0xffffffffffffn, 0x800000000000n, 0x123456789abcn];
const words = new BigUint64Array(heads.length * tails.length);
let at = 0;
for (const head of heads) for (const tail of tails) words[at++] = (BigInt(head) << 48n) | tail;
const numbers = new Float64Array(words.buffer);
let row = "";
for (let i = 0; i < numbers.length; i++) row += kit.other(numbers[i]) ? "n" : ".";
console.log(row);
console.log(kit.count(numbers), numbers.length);
const view = new DataView(words.buffer);
let second = "";
for (let i = 0; i < numbers.length; i++) second += kit.other(view.getFloat64(i * 8, true)) ? "n" : ".";
console.log(second === row);
const singles = new Float32Array(new Uint32Array([0x7fc00000, 0xffc00000, 0x7f800001, 0xff800001, 0x7f800000, 0xff800000, 0x7fffffff, 0]).buffer);
let third = "";
for (let i = 0; i < singles.length; i++) third += kit.other(singles[i]) ? "n" : ".";
console.log(third);
