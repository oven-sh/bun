const log = []; let heap = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 1));
function churn() { heap = []; for (let i = 0; i < 20000; i++) heap.push({ count: -i, tag: "junk", next: i, return: i }); }
function collect() { Bun.gc(true); churn(); Bun.gc(true); }
function source(tag, limit, failAt) { return { [Symbol.asyncIterator]() { return { count: 0, tag,
  next() { const turn = ++this.count; collect(); return new Promise((resolve, reject) => setTimeout(() => { collect(); if (turn === failAt) reject(new RangeError("no")); else resolve({ done: turn > limit, value: turn }); }, 1)); },
  return() { log.push("return " + this.tag + " " + this.count); return new Promise(resolve => setTimeout(() => { collect(); resolve({}); }, 1)); } }; } }; }
async function drain(things, stopAt, how) { let sum = 0;
  try { for await (const thing of things) { sum += thing; await pause(); collect(); if (thing === stopAt) { if (how === "throw") throw new URIError("body"); break; } } }
  catch (error) { log.push("caught " + error.name); }
  return sum; }
async function* relay(rows) { let seen = 0;
  outer: for await (const row of rows) { for await (const cell of source("in" + row, 9, 0)) { if (cell === 3) continue outer; seen += cell; yield seen; } }
  return "end " + seen; }
async function drive(how) { log.length = 0; const walker = relay(source("out", 2, 0)), got = []; let last;
  for (let turn = 0; turn < 3; turn++) { got.push((await walker.next()).value); collect(); await pause(); collect(); }
  try { const step = how === "return" ? await walker.return("left") : how === "throw" ? await walker.throw(new URIError("in")) : await walker.next(); last = step.done + " " + step.value; } catch (error) { last = error.name; }
  console.log(`${how} ${got.join(",")} ${last} [${log.join("|")}]`); }
for (const [name, limit, failAt, stopAt, how] of [["ends", 4, 0, 99, ""], ["breaks", 9, 0, 3, "break"], ["throws", 9, 0, 2, "throw"], ["rejects", 9, 3, 99, ""]]) { log.length = 0; const sum = await drain(source(name, limit, failAt), stopAt, how); console.log(`${name} ${sum} [${log.join("|")}]`); }
await drive("next"); await drive("return"); await drive("throw");
