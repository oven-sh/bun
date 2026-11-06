// A text is begun with numbers and constants; then a call changes what was read, or a read throws; then the text is ended or appended.
const out = [];
let counter = 0;
function bump() { counter += 10; return counter; }
const rows = [{ id: 1, name: "ann" }, { id: 2, name: "bob" }, null, { id: 4 }, { id: 5, get name() { counter++; return "got" + counter; } }];
function line(i) { let k = counter; const head = k + ":" + (i & 1 ? "," : "") + true + null + undefined + 1.5; k = bump(); return head + "|" + k + "|" + counter; }
function list(from, to) {
  let text = "[";
  try {
    for (let k = from; k < to; k++) text += (k ? "," : "") + '{"id":' + (rows[k].id + from) + ',"name":"' + rows[k].name + '"}';
  } catch (e) { return text + "!" + e.constructor.name; }
  return text + "]";
}
function kept(i) { let text = "a"; const parts = []; for (let k = 0; k < 3; k++) { const head = k + "-" + i; parts.push(text); text += head + bump() + ";"; } return text + parts.join("/"); }
function nested(i) { return "<" + (i + "." + (i + 1 + ":" + (bump() + "," + i))) + ">"; }
function key(a, b) { const table = { "1:2": "one-two", "3:4": "three-four" }; const k = a + ":" + b; bump(); return table[k] + k; }
for (let round = 0; round < 300; round++) {
  out.length = 0; counter = 0;
  out.push(line(0), line(1), list(0, 2), list(0, 3), list(1, 2), list(3, 4), list(4, 5), list(3, 5), list(0, 0), kept(round & 1), nested(7), key(1, 2), key(3, 4), key(5, 6));
}
console.log(out.join("\n"));
