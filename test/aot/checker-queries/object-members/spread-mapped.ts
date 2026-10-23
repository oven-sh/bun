// A copy of a mapped member is written only if the mapped type is trusted. An access on the spread is unwritten either way.
/// <reference path="./spread-mapped.d.ts" />
interface Config { a: number }
declare const config: Config;
declare const stringified: Stringify<Config>;
declare const partial: Partial<Config>;
const untrusted = { ...config, ...stringified };
const trusted = { ...config, ...partial };
untrusted.a;
trusted.a;
let t1: typeof untrusted;
let t2: typeof trusted;
export {};
