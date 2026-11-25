const kept = [];
const keeper = { each(job) { kept.push(job); return 0; } };
const caller = { each(job) { return job(); } };
const buses = JSON.parse("[1,0]").map((n) => (n ? keeper : caller));
function make(start, wants) {
  let total = start;
  function add() { total++; }
  add();
  if (wants) return () => total;
}
function once(receiver, n) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = receiver.each(make(n | 0, true));
  return got + work;
}
function drive() {
  let sum = 0;
  for (let t = 0; t < 400; t++) sum += once(buses[t & 1], t * 10);
  return sum;
}
function check() {
  let wrong = 0;
  for (let k = 0; k < kept.length; k++) if (kept[k]() !== k * 20 + 1) wrong++;
  return wrong;
}
console.log(make(5, false) === undefined, drive(), kept.length, check());
