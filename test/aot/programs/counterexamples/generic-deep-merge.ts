// A deep merge written once for all types: what it makes has every member its result type names.
interface Inner { n: number; tags: string[] }
interface R { a: number; b: string; inner: Inner }
function merge<T extends { inner: object }, U extends { inner: object }>(x: T, y: U): T & U { return { ...x, ...y, inner: { ...x.inner, ...y.inner } } as T & U }
const r: R = { a: 1, b: "x", inner: { n: 1, tags: ["t"] } };
const w = merge(r, { inner: { n: 100 } });
console.log(w.a, w.b, w.inner.n, w.inner.tags.join());
