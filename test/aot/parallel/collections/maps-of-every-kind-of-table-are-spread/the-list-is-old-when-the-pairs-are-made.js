// A full collection runs between the birth of the list and the spread of the map, so the list is old when it gets the pairs, which are young and which it alone holds.
// The collections of the young that follow must find them through it.
const map = new Map(); for (let i = 0; i < 3000; i++) map.set(i, { i });
const first = new Map([["f", 1]]);
// Nothing is stored into the list between the collection and the spread: a store would make the collector look at the list again by itself.
const collect = () => { Bun.gc(true); };
function fill() { return ["head", ...first, ...(collect(), map)]; }
let wrong = 0, seen = 0;
for (let turn = 0; turn < 8; turn++) {
  const list = fill();
  let junk = [0, 0];
  for (let i = 0; i < 600000; i++) junk = [i, junk.length];
  for (let i = 0; i < 3000; i++) {
    const pair = list[2 + i];
    seen++;
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== i || pair[1] !== map.get(i)) wrong++;
  }
}
console.log(seen, wrong);
