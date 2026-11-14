// The loop expects an array. What is like one goes through a rare copy of the loop, whose stores are cached as well.
// STATISTIC: RareLoopStoresCached >= 1
const turns = JSON.parse("40");
const like = JSON.parse('{"length":20,' + Array.from({ length: 20 }, (_, i) => `"${i}":{"id":${i},"n":${i}}`).join() + "}");
let sets = 0, s = 0;
function store(l) { for (let i = 0; i < l.length; i++) l[i].n = 5; return l[3].n; }
for (let t = 0; t < turns; t++) {
  s += store(like);
  if (t === 10) Object.freeze(like[4]);
  if (t === 20) Object.defineProperty(like[5], "n", { set(v) { sets += v; }, get() { return 1; } });
  if (t === 25) like[6] = JSON.parse('{"n":1,"more":2}');
  if (t === 30) delete like[7].n;
}
console.log(s, sets, JSON.stringify(like));
