// Two instances of a class that refer to each other are made in every turn of a hot loop and kept, in a local that starts as null, in one turn only. The variable of the function that makes them may also hold a Proxy of it, so the loop has a path on which anything may come back. The function with the loop is called in a loop.
class Node { constructor(value, next, tag) { this.value = value; this.next = next; this.tag = tag; } }
function makeRing(value, keep) {
  const first = new Node(value, null, "first"), second = new Node(value + 1, first, "second");
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
let last = "";
for (let r = 0; r < 50; r++) last = main();
console.log(last);
function replace() { makeRing = new Proxy(makeRing, {}); }
if (last === "") replace();
