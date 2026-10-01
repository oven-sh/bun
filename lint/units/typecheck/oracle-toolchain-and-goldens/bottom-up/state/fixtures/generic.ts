interface Box<T> {
    value: T;
    map<U>(f: (t: T) => U): Box<U>;
}
declare const b1: Box<string>;
declare const b2: Box<Box<number>>;
type Keys = keyof Box<string>;
type Value = Box<string>["value"];
type Flagged = { readonly [P in "a" | "b"]?: P };
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };
declare const picked: Pick2<{ x: 1; y: 2 }, "x">;
type Elem<T> = T extends (infer E)[] ? E : never;
declare const elem: Elem<string[]>;
type Pair = `${"a" | "b"}-${1 | 2}`;
type Upper = Uppercase<"ab">;
type Rec<T> = { self: Rec<T>; item: T };
declare const rec: Rec<number>;
declare function pick<T, K extends keyof T>(o: T, k: K): T[K];
