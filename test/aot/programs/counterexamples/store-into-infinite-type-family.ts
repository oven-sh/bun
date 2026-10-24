// A valid store into a type that never ends, while a second family of such types stands in the program.
declare const console: { log(...values: unknown[]): void };
interface Key { key: number }
const untyped = (x: any): any => x;
interface F2<T> { value: T; more?: F2b<(x: T) => number> }
interface F2b<T> { value: T; more?: F2<(x: T) => number> }
const v2 = untyped({ value: { key: 1 }, more: { value: (x: Key) => 1, more: { value: (x: (x: Key) => number) => 2 } } }) as F2<Key>;
{ const kept = v2.more; v2.more = { value: (x: Key) => 37, more: { value: (x: (x: Key) => number) => 38 } }; console.log(v2.more!.value({ key: 39 })); v2.more = kept; console.log(v2.more === kept); }
interface F3<T> { value: T; more?: F3b<{ inner: T }> }
interface F3b<T> { value: T; more?: F3<{ inner: T }> }
const v3 = JSON.parse(JSON.stringify({ value: { key: 40 }, more: { value: { inner: { key: 41 } }, more: { value: { inner: { inner: { key: 42 } } } } } })) as F3<Key>;
