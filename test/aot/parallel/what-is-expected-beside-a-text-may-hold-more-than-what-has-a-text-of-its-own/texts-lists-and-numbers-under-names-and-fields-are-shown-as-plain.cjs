"use strict";
// a field and a computed key hold a text, a list or a number by what the program stores; each is shown beside a text, alone, through a ternary, and out of one of two holders
function fill(text) {
  const out = {};
  for (const pair of text.split("&")) {
    const at = pair.indexOf("=");
    const name = pair.slice(0, at), value = pair.slice(at + 1);
    const held = out[name];
    if (held === undefined) out[name] = value.length > 2 ? Number(value) : value;
    else if (Array.isArray(held)) held.push(value);
    else out[name] = [held, value];
  }
  return out;
}
function cell(value) { return { value }; }
function show(query, other, first) {
  let out = "";
  for (const name in query) out += name + "=" + query[name] + ";";
  for (const name in query) out += name + ":" + (Array.isArray(query[name]) ? query[name].join("|") : query[name]) + ";";
  for (const name in query) out += name + "~" + (first ? query[name] : other[name]) + ";";
  return out;
}
function showCells(cells) { let out = ""; for (let i = 0; i < cells.length; i++) out += i + "=" + cells[i].value + ";"; return out; }
const said = [];
for (let round = 0; round < 60; round++) {
  const query = fill("q=ab&page=" + (100 + round) + "&tag=a&tag=b&tag=c&empty=&n=12");
  const other = fill("q=cd&tag=z&page=7");
  said.length = 0;
  said.push(show(query, other, round & 1), showCells([cell("t"), cell(["a", ["b"]]), cell(round), cell(null), cell(undefined), cell(1.5), cell(true), cell({ toString() { return "own"; } })]));
  try { said.push(showCells([cell("t"), cell(Symbol("s"))])); } catch (e) { said.push(e.constructor.name); }
  try { said.push(showCells([cell(10n), cell([]), cell([[]]), cell([null, undefined])])); } catch (e) { said.push(e.constructor.name); }
}
console.log(said.join("\n"));
