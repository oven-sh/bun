// A type of the default library that names a built-in class is that class. It is exact where only instances of the class fit the type, and a view where other objects fit it too: a read-only form, or a type that a declaration file outside the default library extends, as bun-types does with `Promise` and `Error`.
let a: Map<string, number>;
let b: ReadonlyMap<string, number>;
let c: Promise<string>;
let d: Error;
let e: Intl.DateTimeFormat;
let f: Set<number>;
let g: ReadonlySet<number>;
export {};
