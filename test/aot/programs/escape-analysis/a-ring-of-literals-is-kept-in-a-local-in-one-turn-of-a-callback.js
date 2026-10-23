// Two object literals that refer to each other are made in every turn of a hot loop and kept, in a local that starts as null, in one turn only. The variable of the function that makes them may also hold a Proxy of it, so the loop has a path on which anything may come back. The function with the loop is called by the callback of Array.from.
function makeRing(value, keep) {
  const first = { value, next: null, tag: "first" }, second = { value: value + 1, next: first, tag: "second" };
  first.next = second;
  if (keep) return first;
  return first.next.next.value + second.next.next.value;
}
function main() {
  let ringTotal = 0, ring = null;
  for (let i = 0; i < 1000; i++) {
    const result = makeRing(i, i === 777);
    if (typeof result === "number") ringTotal += result; else ring = result;
  }
  return [ringTotal, Object.keys(ring).join(), Object.keys(ring.next).join(), ring.value, ring.next.value, ring.tag, ring.next.tag, ring.next.next === ring].join(" ");
}
const all = Array.from({ length: 40 }, () => main());
console.log(all[39], new Set(all).size);
function replace() { makeRing = new Proxy(makeRing, {}); }
if (all.length === 0) replace();
