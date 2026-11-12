// An untyped package and a program of it (grows): a radix of segments, wildcards and parameters, with backtracking
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const t = new lib(); let found = 0;
for (let i = 0; i < 60; i++) {
  t.add(i % 3 ? 'GET' : 'ANY', '/' + ['u', ':id', 'p' + i % 5, i % 7 ? ':k' : '*'].slice(0, 2 + i % 3).join('/'), i);
  for (let j = 0; j <= i; j += 9) { const h = t.find('GET', '/u/' + j + '/p' + j % 5 + (j % 2 ? '/deep/er' : '')); if (h) { found++; say(i, j, h.value, JSON.stringify(h.params)); } }
}
say(found, t.size);
