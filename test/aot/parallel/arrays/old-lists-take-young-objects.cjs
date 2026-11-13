// Lists that lived through collections are pushed objects made a moment ago, one and several at a time, and are read behind the next collection.
"use strict";
const hide = v => [v][JSON.parse("0")], gc = full => { if (typeof Bun !== "undefined") Bun.gc(full); }, push = (a, x) => a.push(x), two = (a, x, y) => a.push(x, y), four = (a, x, y, z, w) => a.push(x, y, z, w), pop = a => a.pop();
const make = t => Array.from({ length: 40 }, () => JSON.parse(t)), lists = [...make('["a",null,"b","c","d","e","f","g"]'), ...make("[]"), ...make("[1,2,3]")];
gc(true); gc(true); let lost = 0, seen = 0;
for (let round = 0; round < 60; round++) {
  for (const l of lists) { if (l.length > 24) l.length = 2; const n = round * 7 + l.length; hide(push)(l, { n }); hide(two)(l, { n: n + 1 }, { n: n + 2 }); hide(four)(l, n, { n: n + 3 }, "t" + n, { n: n + 4 }); }
  let junk = []; for (let i = 0; i < 3000; i++) junk.push({ n: -i }); junk = null; if (round % 7 === 0) gc(round % 14 === 0);
  for (const l of lists) { const e = l.slice(-7), n = e[3]; seen++; if (e[0].n !== n || e[1].n !== n + 1 || e[2].n !== n + 2 || e[4].n !== n + 3 || e[5] !== "t" + n || e[6].n !== n + 4) lost++; if (round & 1) { const last = hide(pop)(l); if (last.n !== n + 4) lost++; hide(push)(l, last); } }
}
console.log(seen, lost, lists.reduce((s, l) => s + l.length, 0));
