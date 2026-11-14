import { nextTurns } from "../host.ts";
function Root() { if (!(this instanceof Root)) throw new TypeError("new"); this.root = 1; }
function Middle() { if (!(this instanceof Middle)) throw new TypeError("new"); Root.call(this); this.middle = 2; }
function Leaf() { if (!(this instanceof Leaf)) throw new TypeError("new"); Middle.call(this); this.leaf = 3; }
Object.setPrototypeOf(Middle.prototype, Root.prototype); Object.setPrototypeOf(Middle, Root);
Object.setPrototypeOf(Leaf.prototype, Middle.prototype); Object.setPrototypeOf(Leaf, Middle);
function bench(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += new Leaf().leaf;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
