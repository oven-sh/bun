// A proxy of an instance, and a proxy that answers for its prototype by a trap, stand on the left of `instanceof` against a class of the program.
class Leaf { constructor() { this.a = 1; } }
function isLeaf(x) { return x instanceof Leaf; }

let traps = 0;
function deed(kind) {
  if (kind === 0) return new Proxy(new Leaf(), {});
  if (kind === 1) return new Proxy({}, { getPrototypeOf() { traps++; return Leaf.prototype; } });
  if (kind === 2) return new Proxy(new Leaf(), { getPrototypeOf() { traps++; return null; } });
  return new Leaf();
}
console.log(String(isLeaf(deed(0))), String(isLeaf(deed(1))), String(isLeaf(deed(2))), String(isLeaf(deed(3))), String(traps));
let count = 0;
for (let i = 0; i < 200; i++) count += isLeaf(deed(i % 4)) ? 1 : 0;
console.log(String(count), String(traps));
const { proxy, revoke } = Proxy.revocable(new Leaf(), {});
console.log(String(isLeaf(proxy)));
revoke();
try { console.log(String(isLeaf(proxy))); } catch (error) { console.log(error.name); }
