"use strict";
// `for (..; i < data[w].length; ..) s = s + data[w][i]`: holder and key are parameters of which nobody knows anything. Where the holder is a plain object and the key a text under which an own value
// lies, the read runs no code and finds the same in every turn, so it is made once in front. Whatever they are, the answer is plain's. HERE: the key is an object: each read turns it into a text.
const text = "[" + Array.from({ length: 12 }, (_, i) => (i * 7) % 31 + 1).join() + "]", zero = JSON.parse("0");
const made = () => JSON.parse('{"rows":' + text + ',"other":[1,2,3]}');
let counted = 0;
const held = made(), key = { toString() { counted++; return "rows"; } }, more = 0;
const handed = [held][zero], under = [key][zero], beside = [more][zero];
function f(data, w, extra, t) { let s = t & 1; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; } return s; }
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
console.log(tried(() => f(handed, under, beside, 0)), counted, tried(() => f(handed, under, beside, 1)), counted);
