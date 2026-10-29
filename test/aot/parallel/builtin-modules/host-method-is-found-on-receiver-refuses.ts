// A method of a host class is found on a receiver that it refuses, and the receiver has been through native code, stands below an object that native code made, or is asked by a protocol.
function told(run: () => unknown): string {
  try { return "answered " + String(run()); } catch (error: any) { return `${error?.code}: ${error?.message}`; }
}
const custom = Symbol.for("nodejs.util.inspect.custom");
const later = (value: unknown) => new Promise<any>(resolve => setTimeout(resolve, 0, value));

const below = await later(Object.create(Blob.prototype, { constructor: { get() { return { name: "One" }; } } }));
console.log(1, told(() => below.text()));
const shown = await later(Object.create(Blob.prototype, { constructor: { value: undefined }, [custom]: { value(depth: number, options: object, inspect: unknown) { return "Two " + typeof inspect; } } }));
console.log(2, told(() => shown.text()));
const holding = await later({ text: Blob.prototype.text, get constructor() { return { name: "Three" }; } });
console.log(3, told(() => holding.text()));
const made: any = structuredClone(new Blob(["a"]));
console.log(4, told(() => Object.create(made, { constructor: { get() { return { name: "Four" }; } } }).text()));
console.log(5, told(() => Object.create(takeHeaders(), { constructor: { get() { return { name: "Five" }; } } }).get("a")));
function takeHeaders(): any { return new Response("a").headers; }
const steps = new Headers({ a: "b" }).entries();
console.log(6, told(() => { for (const step of { [Symbol.iterator]() { return Object.create(steps, { constructor: { get() { return { name: "Six" }; } } }); } }) return step; }));
console.log(7, told(() => Array.from({ __proto__: Headers.prototype, get constructor() { return { name: "Seven" }; } } as any)));
console.log(8, told(() => [...({ [Symbol.iterator]: Headers.prototype.entries, get constructor() { return { name: "Eight" }; } } as any)]));
class Kept extends Headers { get ["constructor"]() { return { name: "Nine" } as any; } }
console.log(9, told(() => [...new Kept({ a: "b" })].join()));
console.log(10, told(() => JSON.stringify(structuredClone({ a: 1 }))));
