"use strict";
// `for (..; i < data[w].length; ..) s = s + data[w][i]`: holder and key stand in front of the loop and nobody knows them. HERE: holder and key are consts of the file, straight out of JSON.parse.
const text = "[" + Array.from({ length: 12 }, (_, i) => (i * 7) % 31 + 1).join() + "]";
const data = JSON.parse('{"rows":' + text + '}'), w = JSON.parse('"rows"');
function f(t) { let s = t & 1; for (let i = 0; i < data[w].length; i++) s = s + data[w][i]; return s; }
console.log(f(0), f(1), f(2));
