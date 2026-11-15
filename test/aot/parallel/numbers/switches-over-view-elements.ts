// Switches over elements of views, in bounds and out of bounds.
const source = [0, 1, 2, 3, 5, 8, 255, 300, -1, -128, 4294967295, 2147483647, -2147483648, 6, 13, 40];
const bytes = Uint8Array.from(source), words = Int32Array.from(source), wide = Uint32Array.from(source), short = Int16Array.from(source);
function ofByte(view: Uint8Array, i: number): string {
  switch (view[i]!) {
    case 0: return "zero";
    case 1: case 2: return "few";
    case 255: return "last";
    case 5: case 6: case 7: case 8: return "some";
    default: return "other";
  }
}
function ofWord(view: Int32Array, i: number): number {
  let result = 1;
  switch (view[i]) {
    case -2147483648: result += 2;
    case -1: result += 4; break;
    case 2147483647: result += 8;
    default: result += 16;
    case 0: result += 32; break;
    case 13: result += 64;
  }
  return result;
}
function ofWide(view: Uint32Array, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    switch (view[i]!) {
      case 4294967295: sum += 1; break;
      case 4294967168: sum += 10; break;
      case 2147483648: sum += 100; break;
      case 0: sum += 1000; break;
      default: sum += 10000;
    }
  }
  return sum;
}
class Machine {
  private at = 0;
  constructor(private readonly code: Uint8Array) {}
  private next(): number { return this.code[this.at++]!; }
  run(steps: number): string {
    let out = "";
    while (steps-- > 0) {
      const op = this.next();
      switch (op) {
        case 0: out += "a"; break;
        case 1: out += "b" + this.next(); break;
        case 2: out += "c"; continue;
        case 3: out += "d"; break;
        case 5: this.at++; break;
        case 255: out += "e"; break;
        default: out += typeof op + op;
      }
      out += ",";
    }
    return out;
  }
}
const indexes: unknown[] = [0, 1, 2, 4, 6, 7, 10, 11, 12, 14, 15, 16, 40, -1, 1.5, NaN, "3", undefined];
for (const index of indexes) console.log(String(index), ofByte(bytes, index as number), ofWord(words, index as number));
for (const n of [0, 1, 8, 16, 20]) console.log(n, ofWide(wide, n), new Machine(bytes).run(n), short.length);
const resizable = new ArrayBuffer(8, { maxByteLength: 64 }), view = new Uint8Array(resizable);
view.set([0, 1, 2, 255, 5, 6, 7, 8]);
console.log(new Machine(view).run(9));
resizable.resize(2);
console.log(new Machine(view).run(9), ofByte(view, 1), ofByte(view, 2));
export {};
