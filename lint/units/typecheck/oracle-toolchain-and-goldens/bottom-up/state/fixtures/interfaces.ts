interface Base<T> {
    id: T;
    next?: Base<T>;
}
interface Named {
    readonly name: string;
}
interface Derived extends Base<string>, Named {
    (x: number): string;
    new (x: string): Derived;
    readonly [k: string]: unknown;
    method<U>(u: U): Base<U>;
}
interface Derived {
    extra: Color;
}
enum Color { Red, Green = 2, Blue }
declare const enum Flags { None = 0, A = 1 << 0, B = A | 2 }
declare enum Names { First = "first", Second = "second" }
interface Outer<T> {
    inner: { value: T; list: T[] };
}
