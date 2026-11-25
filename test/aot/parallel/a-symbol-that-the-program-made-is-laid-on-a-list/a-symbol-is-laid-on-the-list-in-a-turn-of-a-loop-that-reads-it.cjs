"use strict";
const mark = Symbol("mark"), other = Symbol("other");
function hidden(v) { return JSON.parse(JSON.stringify({ v })).v; }
function sum(list, when, key, value) { let s = 0, seen = ""; for (let i = 0; i < list.length; i++) { if (i === when) list[key] = value; s += list[i]; seen += String(list[key]) + (key in list ? "+" : "-") + list.length + " "; } return s + " " + seen; }
function iterate(list, when, key, value) { let s = 0, i = 0; for (const x of list) { if (i++ === when) list[key] = value; s += x; } return s + " " + String(list[key]); }
function methods(list, when, key, value) { let out = ""; for (let i = 0; i < 4; i++) { if (i === when) list[key] = value; out += list.map((x) => x + 1).join() + "|" + list.slice(1).length + "|" + list.indexOf(2) + "|" + [...list].length + "|" + list.concat([9]).length + " "; } return out; }
for (const make of [() => [1, 2, 3, 4], () => hidden([1, 2, 3, 4]), () => [1.5, 2, 3, 4], () => ["a", 2, 3, 4], () => new Array(4).fill(2), () => Array.from({ length: 4 }, (_, i) => i)])
  for (const when of [0, 2, 3, 9]) for (const key of [mark, other]) {
    console.log(sum(make(), when, key, 7)); console.log(iterate(make(), when, key, 7)); console.log(methods(make(), when, key, 7));
  }
