// An `as` clause that only filters keys follows the modifiers type; one that renames keys is unwritten.
interface Config { a: number; b: number }
interface Table { [key: string]: number }
type Without<T, X> = { [K in keyof T as Exclude<K, X>]: T[K] };
type Renamed<T> = { [K in keyof T as `get_${string & K}`]: T[K] };
let v1: Without<Config, "b">;
let v2: Renamed<Config>;
let v3: Without<Table, "b">;
export {};
