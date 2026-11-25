// A field that goes leaves the other names in their order, whatever stands beside it: an added name, another field, or nothing.
function born(i) {
  return { a: i, b: i + 1, c: i + 2, d: i + 3, e: i + 4, f: i + 5, g: i + 6, h: i + 7 };
}
const fields = ["a", "b", "c", "d", "e", "f", "g", "h"];
const deeds = {
  front(o) { for (const k of fields) { delete o[k]; say(o); } },
  behind(o) { for (const k of fields.toReversed()) { delete o[k]; say(o); } },
  apart(o) { for (const k of ["b", "d", "f", "h", "a", "c", "e", "g"]) { delete o[k]; say(o); } },
  back(o) { for (const k of fields) { delete o[k]; o["x" + k] = 1; o[k] = 2; say(o); } for (const k of fields) { delete o[k]; say(o); } },
  between(o) { for (const k of fields) { delete o[k]; o["y" + k] = k; delete o["y" + k]; o[k] = k; } say(o); for (const k of fields) delete o["x" + k], delete o[k]; say(o); },
  turns(o) { for (let turn = 0; turn < 40; turn++) { const k = fields[(turn * 3) & 7]; delete o[k]; if (turn & 1) o["t" + turn] = turn; o[k] = turn; if (turn % 5 === 0) delete o["t" + (turn - 1)]; } say(o); },
};
let said = [];
function say(o) {
  const keys = [];
  for (const k in o) keys.push(k);
  said.push(Object.keys(o).join("") + (keys.join() === Object.keys(o).join() ? "" : " differs") + JSON.stringify({ ...o }).length);
}
for (const [name, deed] of Object.entries(deeds)) {
  said = [];
  for (let i = 0; i < 3; i++) {
    const o = born(i);
    if (i === 1) o.late = 1;
    if (i === 2) { o[Symbol("s")] = 2; delete o.c; o.mid = 0; o.c = 9; }
    deed(o);
  }
  console.log(name, said.join(" "));
}
// Many fields of one literal, each deleted once.
const text = Array.from({ length: 300 }, (_, i) => `n${i}: ${i}`).join();
const many = { n0: 0, n1: 1, n2: 2, n3: 3, n4: 4, n5: 5, n6: 6, n7: 7, n8: 8, n9: 9, n10: 10, n11: 11, n12: 12, n13: 13, n14: 14, n15: 15, n16: 16, n17: 17, n18: 18, n19: 19 };
for (let i = 0; i < 20; i += 2) delete many["n" + i];
for (let i = 0; i < 20; i += 4) many["n" + i] = -i;
for (let i = 1; i < 20; i += 6) delete many["n" + i];
console.log(Object.entries(many).join(" "), text.length);
