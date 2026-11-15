type Nest<T> = { inner: T } & { or?: Nest<{ inner: T }> };
const nest = JSON.parse('{"inner":"a","or":{"inner":{"inner":"b"}}}') as Nest<string>;
console.log(Object.keys(nest).length, nest.inner, nest.or?.inner.inner, nest.or?.or);
export {};
