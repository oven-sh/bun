// A generic type with an optional member is applied to itself nine times, and a closure reads the innermost member.
declare const console: { log(...values: unknown[]): void };
interface Key { key: number }
type F<T> = { value: T; more?: number };
const w: F<F<F<F<F<F<F<F<F<Key>>>>>>>>> = { value: { value: { value: { value: { value: { value: { value: { value: { value: { key: 7 } } } } } } } } } };
const f = () => w.value.value.value.value.value.value.value.value.value.key;
console.log(f());
