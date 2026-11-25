// An object whose prototype is a proxy of an instance stands on the left of `instanceof` against the class of that instance.
class Leaf { constructor() { this.a = 1; } }
function isLeaf(x) { return x instanceof Leaf; }

let traps = 0;
function deed(kind) {
  if (kind === 0) return Object.create(new Proxy(new Leaf(), {}));
  if (kind === 1) return Object.create(new Proxy({}, { getPrototypeOf() { traps++; return traps % 2 ? Leaf.prototype : null; } }));
  if (kind === 2) { const record = { own: 1 }; Object.setPrototypeOf(record, new Proxy(Leaf.prototype, {})); return record; }
  return { own: 2 };
}
console.log(String(isLeaf(deed(0))), String(isLeaf(deed(1))), String(isLeaf(deed(1))), String(isLeaf(deed(2))), String(isLeaf(deed(3))), String(traps));
let count = 0;
for (let i = 0; i < 200; i++) count += isLeaf(deed(i % 4)) ? 1 : 0;
console.log(String(count), String(traps));
