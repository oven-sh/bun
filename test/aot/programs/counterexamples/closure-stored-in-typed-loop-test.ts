// `h.f = g` in the test of a typed loop stores to the object that h names in that iteration; the objects have an index signature.
declare const console: { log(...a: unknown[]): void };
const a: { [k: string]: unknown } = {}, b: typeof a = {};
for (let h = a, g: unknown = 0; h.f = g, h !== b; ) { const k = h; h = b; g = () => k; }
console.log(typeof a.f, typeof b.f);
