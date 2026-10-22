// Arrays and tuples keep their element types, element kinds and `readonly`.
let v1: number[];
let v2: readonly string[];
let v3: Array<number>;
let v4: ReadonlyArray<string>;
let v5: [number, string];
let v6: [number, ...string[]];
let v7: readonly [number];
let v8: [number, string?];
function f<T extends unknown[]>(x: [...T, number]) {}
export {};
