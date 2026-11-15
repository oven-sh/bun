// The helper hands back what it was given as the fallback.
const DEFAULT = /\s+/;
const orDefault = (given, fallback) => given ?? fallback;
console.log(Object.is(orDefault(undefined, DEFAULT), DEFAULT));
