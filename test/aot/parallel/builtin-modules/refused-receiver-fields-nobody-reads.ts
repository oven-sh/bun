// A function of the host names a value that it refuses in the message of its error, and says there whether the object has properties of its own: fields that nobody reads count.
import { Readable } from "node:stream";
function told(run: () => unknown): string {
  try { return "answered " + String(run()); } catch (error: any) { return `${error.code}: ${error.message}`; }
}
const values: any[] = [
  new (Object.defineProperty(class { x = 1; y = 2; }, "name", { get() { return "Computed"; } }))(),
  new (Object.defineProperty(class {}, "name", { get() { return "Computed"; } }))(),
  { __proto__: null, a: 1 },
  { __proto__: null },
  { get constructor() { return Object; }, b: 2 },
];
for (const value of values) console.log(told(() => Buffer.prototype.compare.call(value, Buffer.alloc(1))));
for (const value of values) console.log(told(() => Buffer.prototype.toString.call(value)));
for (const value of values) console.log(told(() => Buffer.prototype.write.call(value, "x")));
for (const value of values) console.log(told(() => (Blob.prototype as any).text.call(value)));
for (const value of values) console.log(told(() => (URL.prototype as any).toString.call(value)));
for (const value of values) console.log(told(() => (TextDecoder.prototype as any).decode.call(value)));
for (const value of values) console.log(told(() => (Bun.file("x") as any).slice.call(value)));
const Unnamed: any = Object.defineProperty(class { a = 1; }, "name", { get() { return "Computed"; } });
Unnamed.prototype.text = Blob.prototype.text;
console.log(told(() => new Unnamed().text()));
const bare: any = { __proto__: { __proto__: null, text: Blob.prototype.text }, a: 1 };
console.log(told(() => bare.text()));
const bound = Blob.prototype.text.bind({ __proto__: null, c: 3 } as any);
console.log(told(() => bound()));
console.log(told(() => Reflect.apply(Blob.prototype.text, { __proto__: null, d: 4 }, [])));
