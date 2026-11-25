let work = 0;
function pick(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return n % 3 === 0 ? [{ v: n }, { v: -n }] : n % 3 === 1 ? { v: n } : [[{ v: n }]]; }
function run(list) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return list.flatMap(pick); }
const out = run([0, 1, 2, 3, 4, 5]);
console.log(out.length, out.map(each => Array.isArray(each) ? "list " + each[0].v : each.v).join());
