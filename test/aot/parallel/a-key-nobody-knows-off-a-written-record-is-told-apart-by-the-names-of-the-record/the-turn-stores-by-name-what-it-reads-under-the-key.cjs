"use strict";
// `for (..) s += T[k](i)` | `s += T[k]`: T is a record written in the file, k a const of which nobody knows anything. The names of the record are expected of the key: each is tested for, in front of the loop, and
// behind its yes the access is walked by that name; who fails every name runs the loop as written. Whatever key and record are at the run, the answer is plain's. HERE: a turn stores by name into what the next reads under the key.
const zero = JSON.parse("0");
let counted = 0;
const T = { a: 3, b: 0.5 }; const key = "a";
const k = [key][zero];
function f(t) { let s = t & 1; for (let i = 0; i < 12; i++) { s += T[k]; T.a = i; } return s; }
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };

console.log(tried(() => f(0)), counted, tried(() => f(1)), counted);
