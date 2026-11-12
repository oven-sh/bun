const log = []; let heap = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 1));
function churn() { heap = []; for (let i = 0; i < 20000; i++) heap.push({ count: -i, tag: "junk", next: i, return: i }); }
function collect() { Bun.gc(true); churn(); Bun.gc(true); }
const later = value => new Promise(resolve => setTimeout(() => { collect(); resolve(value); }, 1));
function source(tag, limit) { return { [Symbol.asyncIterator]() { return { count: 0, tag,
  next() { const turn = ++this.count; collect(); return later({ done: turn > limit, value: turn }); },
  return() { log.push("return " + this.tag + " " + this.count); return later({}); } }; } }; }
function* pairs() { yield [later(1), 2]; yield [3, later(4)]; }
async function gather() { let sum = 0; for (const pair of pairs()) { for await (const piece of pair) { await pause(); collect(); sum += piece; } } return sum; }
console.log(`gathers ${await gather()}`);
let top = 0;
for await (const thing of source("top", 9)) { top += thing; await pause(); collect(); if (thing === 3) break; }
console.log(`top ${top} [${log.join("|")}]`);
