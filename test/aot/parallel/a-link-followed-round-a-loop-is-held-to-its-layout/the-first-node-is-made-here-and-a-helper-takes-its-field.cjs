const nothing = JSON.parse("null");
function make(tag, up) { return { tag, up, seen: 0 }; }
function chain(n) { let at = make(0, nothing); for (let i = 1; i < n; i++) at = make(i, at); return at; }
const deeds = [o => { delete o.tag; }, o => { Object.defineProperty(o, "tag", { get() { return 77; }, configurable: true }); }, o => {}];
function climb(n, turn) {
  const top = make(n, chain(n));
  deeds[turn % 3](top);
  let sum = 0;
  for (let at = top; at; at = at.up) { if (at.tag === undefined) sum += 1000; else sum += at.tag; if (at.seen) sum += 1; else sum += 2; }
  return sum;
}
let all = 0;
for (let turn = 0; turn < 3000; turn++) all = (all * 7 + climb(5, turn)) % 1000003;
console.log(all);
