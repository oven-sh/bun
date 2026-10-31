// Loops over a parameter declared as a union of arrays, views and strings, given each part, subclasses, views that are shrunk, grown or detached in the loop, and values outside the declared type.
const holder: { list: unknown[] } = JSON.parse('{"list":[]}');
function hide<T>(value: T): T {
  holder.list.push(value);
  return holder.list.pop() as T;
}
const lines: string[] = [];
function say(name: string, run: () => unknown): void {
  let text: string;
  try {
    text = String(run());
  } catch (error) {
    text = (error as Error).constructor.name;
  }
  lines.push(name + " = " + text);
}
type Numbers = number[] | Uint8Array;
type Three = Uint8Array | Float64Array | number[];
type Text = string | Buffer;

function sum(bytes: Numbers): number {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s = (s + bytes[i]!) | 0;
  return s;
}
function sumOfThree(bytes: Three): number {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!;
  return s;
}
function sumOrNothing(bytes: Numbers | null | undefined): number {
  let s = 0;
  for (let i = 0; i < bytes!.length; i++) s = (s + bytes![i]!) | 0;
  return s;
}
function spell(text: Text): string {
  let s = "";
  for (let i = 0; i < text.length; i++) s += text[i] + ",";
  return s;
}
function around(bytes: Three, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to; i++) s += bytes[i] + ",";
  return s;
}
function fill(bytes: Three, value: number): string {
  for (let i = 0; i < bytes.length; i++) bytes[i] = value;
  return around(bytes, 0, bytes.length);
}
function fillPast(bytes: Numbers, from: number, to: number, value: number): string {
  for (let i = from; i < to; i++) bytes[i] = value;
  return around(bytes, 0, bytes.length) + Object.keys(bytes).length;
}
function sumWhile(bytes: Three, each: (i: number) => void): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i] + ",";
    each(i);
  }
  return s + bytes.length;
}
function sumTo(bytes: Numbers, count: number, each: (i: number) => void): string {
  let s = "";
  for (let i = 0; i < count; i++) {
    each(i);
    s += bytes[i] + ",";
  }
  return s + bytes.length;
}
function both(a: Numbers, b: Three): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) s += a[i]! * b[j]!;
  return s;
}

class OwnLength extends Uint8Array {
  override get length(): number {
    return 2;
  }
}
class LongLength extends Float64Array {
  override get length(): number {
    return 6;
  }
}
class List extends Array<number> {
  override get length(): number {
    return 1;
  }
  override set length(_: number) {}
}
function resizable(count: number, most: number): ArrayBuffer {
  const buffer = new ArrayBuffer(count * 8, { maxByteLength: most * 8 });
  new Uint8Array(buffer).fill(3);
  return buffer;
}
function given(): [string, any][] {
  return [
    ["array", [1, 2, 3, 250]],
    ["doubles", [1.5, -0, NaN]],
    ["holes", [1, , 3]],
    ["empty", []],
    ["bytes", new Uint8Array([1, 2, 3, 250])],
    ["buffer", Buffer.from([1, 2, 3, 250])],
    ["part of a buffer", Buffer.from([9, 1, 2, 9]).subarray(1, 3)],
    ["floats", new Float64Array([1.5, 2.5, NaN])],
    ["own length", new OwnLength([1, 2, 3])],
    ["long length", new LongLength([1, 2, 3])],
    ["list", List.from([1, 2, 3])],
    ["length on the instance", Object.defineProperty(new Uint8Array([1, 2, 3]), "length", { value: 1 })],
    ["prototype of arrays", Object.setPrototypeOf(new Uint8Array([1, 2, 3]), Array.prototype)],
    ["array below bytes", Object.setPrototypeOf([1, , 3], new Uint8Array([7, 8, 9]))],
    ["detached", (v => (v.buffer.transfer(), v))(new Uint8Array([1, 2, 3]))],
    ["words", new Int32Array([1, 2, 3])],
    ["clamped", new Uint8ClampedArray([1, 2, 3])],
    ["text", "123"],
    ["object", { length: 2, 0: 4, 1: 5 }],
    ["proxy", new Proxy(new Uint8Array([7, 8]), {})],
    ["null", null],
    ["undefined", undefined],
    ["number", 7],
  ];
}
for (let round = 0; round < 3; round++) {
  for (const [name, value] of given()) {
    say("sum " + name, () => sum(hide(value)));
    say("sum of three " + name, () => sumOfThree(hide(value)));
    say("sum or nothing " + name, () => sumOrNothing(hide(value)));
    say("spell " + name, () => spell(hide(value)));
    say("around " + name, () => around(hide(value), -2, 5));
    say("both " + name, () => both(hide(value), hide(new Float64Array([1, 2]))) + both(hide([1, 2]), hide(value)));
  }
  for (const [name, value] of given()) say("fill " + name, () => fill(hide(value), 300.5));
  for (const [name, value] of given()) say("fill past " + name, () => fillPast(hide(value), -1, 5, -1));
  for (const Kind of [Uint8Array, Float64Array]) {
    const size = Kind.BYTES_PER_ELEMENT;
    for (const [how, view] of [
      ["tracking", (b: ArrayBuffer) => new Kind(b)],
      ["tracking at an offset", (b: ArrayBuffer) => new Kind(b, 16)],
      ["fixed", (b: ArrayBuffer) => new Kind(b, 8, 3)],
    ] as const) {
      const name = Kind.name + " " + how;
      say("shrunk " + name, () => { const b = resizable(8, 16); return sumWhile(hide(view(b)), i => { if (i === 1) b.resize(3 * size); }); });
      say("emptied " + name, () => { const b = resizable(8, 16); return sumWhile(hide(view(b)), i => { if (i === 1) b.resize(0); }); });
      say("grown " + name, () => { const b = resizable(4, 16); return sumWhile(hide(view(b)), i => { if (i === 1) b.resize(48); }); });
      say("transferred " + name, () => { const b = resizable(8, 16); return sumWhile(hide(view(b)), i => { if (i === 1) b.transfer(); }); });
      say("counted " + name, () => { const b = resizable(8, 16); return sumTo(hide(view(b)) as any, 6, i => { if (i === 2) b.resize(size); }); });
    }
  }
}
console.log(lines.join("\n"));
