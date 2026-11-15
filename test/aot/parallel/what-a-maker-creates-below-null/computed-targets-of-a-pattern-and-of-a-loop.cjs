"use strict";
const n = Number(process.argv[2] ?? 3);
const hide = x => [x][JSON.parse("0")];
function filled(i) {
  const r = Object.create(null); r.first = i;
  [r[hide("p" + i)], r.second] = [1, 2];
  ({ a: r[hide("q")], ...r.rest } = { a: 5, b: 6 });
  for (r[hide("last")] of [7, 8, 9]);
  r[hide("first")]++;
  return Object.keys(r).join() + "|" + JSON.stringify(r);
}
console.log(filled(1), filled(2), filled(n));
