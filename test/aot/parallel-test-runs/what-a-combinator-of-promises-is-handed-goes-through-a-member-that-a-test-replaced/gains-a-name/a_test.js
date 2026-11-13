import { test } from "bun:test";
function make(i) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return { n: i + work }; }
function read(r) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return Object.keys(r).length; }
function gather(r) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; Promise.all([r]); return work; }
function sum(list) {
  let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0;
  let total = 0;
  for (let i = 0; i < list.length; i++) total += read(list[i]);
  return total;
}
test("the elements of a combinator go through a replaced member", () => {
  const original = Promise.resolve;
  const originalThen = Promise.prototype.then;
  const kept = [];
  for (let i = 0; i < 300; i++) { const rec = make(i); gather(rec); kept.push(rec); }
  const before = read(kept[7]);
  Promise.resolve = function (value) {
    let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0;
    value.extra = 1;
    return original.call(this, value);
  };
  for (let i = 0; i < 300; i++) gather(kept[i]);
  Promise.resolve = original;
  console.log(before, "|", read(kept[7]));
});
