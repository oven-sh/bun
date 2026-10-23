// A member that a spread copies from a mapped type is written only if the member of the mapped type is. An access on the spread is unwritten either way.
/// <reference path="./spread-mapped-type.d.ts" />
interface Config { a: number; b: number }
type Without<T, X> = { [K in keyof T as Exclude<K, X>]: T[K] };
declare const stringified: Stringify<Config>;
declare const partial: Partial<Config>;
declare const filtered: Without<Config, "b">;
const s1 = { ...stringified };
const s2 = { ...partial };
const s3 = { ...filtered };
s1.a;
s2.a;
s3.a;
let t1: typeof s1;
let t2: typeof s2;
let t3: typeof s3;
export {};
