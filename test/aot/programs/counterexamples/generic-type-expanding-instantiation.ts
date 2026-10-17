// A generic interface has a member whose type is a larger instantiation of itself, so that its types never end.
declare const console: { log(...values: unknown[]): void };
interface Key { key: number }
interface F<T> { value: T; more?: F<T & { extra: T }> }
const v: F<Key> = { value: { key: 1 } };
console.log(v.value.key);
