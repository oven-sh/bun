// Copies of JSON, Reflect, Object and of a callable interface, made with `Object.create(null, descriptors)`.
declare const console: { log(...values: unknown[]): void };
function copyOf<T extends object>(namespace: T): T {
  return Object.freeze(Object.create(null, Object.getOwnPropertyDescriptors(namespace)))
}
export const JSON2 = copyOf(globalThis.JSON)
export const Reflect2 = copyOf(globalThis.Reflect)
export const Object2 = copyOf(globalThis.Object)
export const ObjectPrototype2 = copyOf(globalThis.Object.prototype)
console.log(JSON2.stringify({ a: 1 }), Reflect2.ownKeys({ b: 2 }).join(), Object2.keys({ c: 3 }).join(), typeof ObjectPrototype2.hasOwnProperty, typeof Object2, typeof Object);
interface Labelled { (n: number): string; label: string }
const real: Labelled = Object.assign((n: number) => "r" + n, { label: "real" });
const fake = copyOf(real);
console.log(real(1), real.label, typeof real, fake.label, typeof fake);
try { console.log(fake(2)) } catch (e) { console.log((e as Error).constructor.name) }
