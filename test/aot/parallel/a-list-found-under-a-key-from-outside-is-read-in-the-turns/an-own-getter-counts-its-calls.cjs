"use strict";
// `for (..; i < data[w].length; ..) s = s + data[w][i]`: holder and key are consts of the file of which nobody knows anything. Where the holder is a plain object and the key a text under which an own value
// lies, the read runs no code and finds the same in every turn, so it is made once in front. Whatever they are, the answer is plain's. HERE: an accessor lies under the key on the holder itself: each read is a call.
const text = "[" + Array.from({ length: 12 }, (_, i) => (i * 7) % 31 + 1).join() + "]", zero = JSON.parse("0");
const made = () => JSON.parse('{"rows":' + text + ',"other":[1,2,3]}');
let counted = 0;
const held = made(), list = held.rows, key = "rows", more = 0;
Object.defineProperty(held, "rows", { get() { counted++; return list; }, configurable: true });
const data = [held][zero], w = [key][zero], extra = [more][zero];
function f(t) { let s = t & 1; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; } return s; }
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
console.log(tried(() => f(0)), counted, tried(() => f(1)), counted);
