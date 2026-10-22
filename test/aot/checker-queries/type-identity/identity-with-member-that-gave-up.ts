// A member whose type does not resolve gives up by itself and takes the identity from no type that has it: neither from a type literal, which is identified by where it is written, nor from a computed type, which is identified by its members.
import type { Missing } from "./no-such-file";
declare const bad: { skipped: boolean; bad: Missing; good: number };
declare const good: { skipped: boolean; good: number };
const { skipped: s1, ...spread } = bad;
const { skipped: s2, ...sound } = good;
let v1: { bad: Missing; good: number };
let v2: typeof spread;
let v3: typeof sound;
let v4: typeof spread;
