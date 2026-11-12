import { nextTurns } from "../host.ts";
interface RootObject { root: number }
interface MiddleObject extends RootObject { middle: number }
interface LeafObject extends MiddleObject { leaf: number }
function Root(this: RootObject): void { if (!((this as unknown) instanceof Root)) throw new TypeError("new"); this.root = 1; }
function Middle(this: MiddleObject): void { if (!((this as unknown) instanceof Middle)) throw new TypeError("new"); Root.call(this); this.middle = 2; }
function Leaf(this: LeafObject): void { if (!((this as unknown) instanceof Leaf)) throw new TypeError("new"); Middle.call(this); this.leaf = 3; }
Object.setPrototypeOf(Middle.prototype, Root.prototype); Object.setPrototypeOf(Middle, Root);
Object.setPrototypeOf(Leaf.prototype, Middle.prototype); Object.setPrototypeOf(Leaf, Middle);
const LeafClass = Leaf as unknown as new () => LeafObject;
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += new LeafClass().leaf;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
