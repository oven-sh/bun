// CALLS+ storeInUntyped PutByIdDouble
// CALLS+ extend CloneObjectAndExtendWithNumber
type Shape = { name: string; sides: number };

const numbers: number[] = [0, -0, 1, -1, 1.5, -1.5, 0.1 + 0.2, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 1e21, 1e300, -1e300, 5e-324, Infinity, -Infinity, NaN];

function show(value: unknown): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function storeInUntyped(target: any, value: number) {
  target.value = value;
}

function extend(shape: Shape, sides: number): Shape {
  return { ...shape, sides };
}

function define(value: number): object {
  const made: any = {};
  Object.defineProperty(made, "kept", { value: 1, enumerable: true });
  made.value = value;
  return made;
}

function toIntegers(value: number): string {
  return [value | 0, value >>> 0, ~~value, value >> 1, value << 1, Math.trunc(value), Math.floor(value), Math.ceil(value), Math.round(value), Math.fround(value), Math.f16round(value), Math.clz32(value), Math.imul(value, 3), Math.sign(value), Math.abs(value), Math.sqrt(Math.abs(value))].map(show).join();
}

function untypedToIntegers(value: any): string {
  return [value | 0, value >>> 0, ~~value, Math.trunc(value), Math.floor(value), Math.round(value), Math.clz32(value), value % 7, value * 2, value / 3, value - 1].map(show).join();
}

function elementAt(list: number[], index: number): string {
  return show(list[index]);
}

function atomics(): string {
  const results: (number | bigint)[] = [];
  const buffer = new SharedArrayBuffer(64);
  for (const view of [new Int8Array(buffer), new Uint8Array(buffer), new Int16Array(buffer), new Uint16Array(buffer), new Int32Array(buffer), new Uint32Array(buffer)]) {
    results.push(Atomics.add(view, 1, 5), Atomics.sub(view, 1, 2), Atomics.and(view, 1, 6), Atomics.or(view, 1, 9), Atomics.xor(view, 1, 3), Atomics.exchange(view, 1, 7), Atomics.compareExchange(view, 1, 7, 4), Atomics.load(view, 1), Atomics.store(view, 1, 0));
  }
  const wide = new BigInt64Array(buffer);
  results.push(Atomics.add(wide, 1, 5n), Atomics.sub(wide, 1, 2n), Atomics.and(wide, 1, 6n), Atomics.or(wide, 1, 9n), Atomics.xor(wide, 1, 3n), Atomics.exchange(wide, 1, 7n), Atomics.compareExchange(wide, 1, 7n, 4n), Atomics.load(wide, 1));
  return results.join();
}

function typedArrays(value: number): string {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value);
  const halves = new Float16Array([value]);
  const singles = new Float32Array([value]);
  const clamped = new Uint8ClampedArray([value]);
  const integers = new Int32Array([value]);
  return [view.getUint32(0), view.getUint32(4), view.getFloat32(0), halves[0], singles[0], clamped[0], integers[0]].map(show).join();
}

function strings(text: string): string {
  return [text.indexOf("needle"), text.lastIndexOf("e"), text.includes("hay"), text.toUpperCase().length, text.replace(/[aeiou]+/g, "_").length, /(\d+)-(\d+)/.exec(text)?.[2], text.split(" ").length, text.normalize("NFD").length, text.localeCompare("hay"), text.codePointAt(3), text.padStart(80, "ab").length].join();
}

const stores: ((target: any, value: number) => void)[] = [storeInUntyped];
const extenders: ((shape: Shape, sides: number) => Shape)[] = [extend];
const shape: Shape = { name: "shape", sides: 3 };
const shapes: object[] = [shape, JSON.parse('{"sides":8,"name":"parsed","more":true}'), Object.assign(Object.create({ inherited: 1 }), { name: "inheriting", sides: 7 })];
const targets: any[] = [{}, { value: 1 }, { other: 1, value: "text" }, Object.create({ value: 2 }), [], function () {}];
for (let round = 0; round < 3; round++) {
  for (const value of numbers) {
    const stored: string[] = [];
    for (const target of targets) {
      stores[0](target, value);
      stored.push(show(target.value));
    }
    console.log(show(value), stored.join(), shapes.map(object => show(extenders[0](object as Shape, value).sides)).join(), show((define(value) as any).value));
    console.log(toIntegers(value));
    console.log(untypedToIntegers(value));
    console.log(typedArrays(value), elementAt(numbers, value), Number.isInteger(value), Number.isSafeInteger(value), value.toString(2).length, JSON.stringify({ value }));
  }
}
console.log(atomics());
console.log(strings("a haystack with one needle in it, 123-4567, and café \u{1f600}".repeat(4)));
console.log([(2n ** 100n + 12345678901234567890n) % 97n, BigInt.asIntN(64, 2n ** 63n), BigInt(Number.MAX_SAFE_INTEGER) * 3n].map(String).join());
