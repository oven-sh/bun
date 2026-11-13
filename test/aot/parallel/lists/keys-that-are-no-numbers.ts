const table: number[] = JSON.parse("[0.5,1,1.5,2,2.5,3,0.25,7]");
const zero = table.length - 8;
const ints: number[] = JSON.parse("[1,2,3,4,5,6,7,8]");
const doubles: number[] = JSON.parse("[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]");
const mixed: any[] = JSON.parse('[1,2.5,"t",null,{"v":1},6,7,8]');
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const words = new Int32Array([1, -2, 3, -4, 5, -6, 7, -8]);
const floats = new Float64Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]);
const growing = new Float64Array(new ArrayBuffer(64, { maxByteLength: 128 }));
function keyOf(way: number, k: number): number {
  switch (way) {
    case 0: return k * 0.5;
    case 1: return k * (zero / zero);
    case 2: return Math.sqrt(k - 4);
    case 3: return Math.log(k - 2);
    case 4: return k * 1e19;
    case 5: return (3 - k) * 1.0;
    case 6: return k * -0;
    case 7: return k * 9223372036854775808;
    case 8: return k * -9223372036854775808;
    case 9: return 8 / (k - 3);
    case 10: return k + 1e-9;
    default: return k + table[k & 7];
  }
}
function readInts(list: number[], key: number): string { return String(list[key]) + (list[key] || 0.25); }
function readMixed(list: any[], key: number): string { return typeof list[key] + String(list[key + 1]); }
function readAny(list: any, key: number): string { return String(list[key]); }
function readBytes(view: Uint8Array, key: number): string { return String(view[key]) + (view[key] ?? -1); }
function readFloats(view: Float64Array, key: number): string { return String(view[key]) + (view[key] + 1); }
function storeInts(list: number[], key: number): string { list[key] = 5; return String(list[key]) + list.length; }
function storeAny(list: any, key: number): string { list[key] = 9; return String(list[key]); }
function storeWords(view: Int32Array, key: number): string { view[key] = 77; return String(view[key]); }
function updateFloats(view: Float64Array, key: number): string { view[key] += 2; return String(view[key]); }
function walk(list: number[], from: number): string { let t = 0; for (let j = from; j < from + 3; j++) t += list[j] || 0.5; return String(t); }
for (let way = 0; way < 12; way++) {
  let line = "";
  for (let round = 0; round < 3; round++) {
    const own = ints.slice(), fractions = doubles.slice(), any = mixed.slice();
    for (let k = 0; k < 9; k++) {
      const key = keyOf(way, k);
      const said = [readInts(own, key), readInts(fractions, key), readMixed(any, key), readAny(round & 1 ? own : bytes, key), readBytes(bytes, key), readFloats(floats, key), readFloats(growing, key), walk(own, key), walk(fractions, key), storeWords(words, key), updateFloats(floats, key), updateFloats(growing, key), storeInts(own, key), storeAny(any, key), storeAny(bytes, key)];
      if (round === 1) line += said.join() + " ";
    }
    if (round === 1) line += Object.keys(own).length + " " + Object.keys(any).join();
  }
  console.log(line);
}
