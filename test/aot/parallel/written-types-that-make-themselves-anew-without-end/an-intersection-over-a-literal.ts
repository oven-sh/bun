type Nest<T> = { inner: T } & { or?: Nest<{ inner: T }> };
const nest: Nest<string> = { inner: "a", or: { inner: { inner: "b" }, or: { inner: { inner: { inner: "c" } }, or: { inner: { inner: { inner: { inner: "d" } } } } } } };
console.log(Object.keys(nest).length, nest.inner, nest.or?.inner.inner, nest.or?.or?.or?.inner.inner.inner.inner);
export {};
