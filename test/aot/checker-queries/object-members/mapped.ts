// A member of a library mapped type is written if its source is. A mapped type of another `.d.ts` has the trust of the type it maps, and its members are unwritten.
/// <reference path="./mapped.d.ts" />
interface Config { a: number }
let v1: Partial<Config>;
let v2: Record<"a", number>;
let v3: Partial<Host>;
let v4: Mine<Config>;
type Renamed<T> = { [K in keyof T as `get_${string & K}`]: T[K] };
let v5: Partial<HostOptions>;
let v6: Partial<HostTable>;
let v7: Renamed<Host>;
let v8: Partial<Record<"a", number>>;
let v9: Readonly<Record<string, number>>;
export {};
