import { test } from "bun:test";
function make(i) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return { n: i + work }; }
function read(r) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return r.n; }
async function gather(r) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; await Promise.all([r]); return work; }
function sum(list) {
  let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0;
  let total = 0;
  for (let i = 0; i < list.length; i++) total += read(list[i]);
  return total;
}
test("the elements of a combinator go through a replaced member", async () => {
  const original = Promise.resolve;
  const originalThen = Promise.prototype.then;
  const kept = [];
  for (let i = 0; i < 300; i++) { const rec = make(i); await gather(rec); kept.push(rec); }
  const before = typeof read(kept[7]) + " " + sum(kept);
  Promise.prototype.then = function (f, g) { return originalThen.call(this, (v) => { if (v && v[0] && typeof v[0].n === "number") v[0].n = "t"; return f(v); }, g); };
  for (let i = 0; i < 300; i++) await gather(kept[i]);
  Promise.prototype.then = originalThen;
  console.log(before, "|", typeof read(kept[7]), String(sum(kept)).length);
});
