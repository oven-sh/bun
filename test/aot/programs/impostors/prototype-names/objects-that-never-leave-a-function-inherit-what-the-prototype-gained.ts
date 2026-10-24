// These objects are made, filled, read and dropped inside one function: a compiler may never allocate them and answer their reads at build time.
// They still have a prototype. Once it gains a value, a getter or a setter under the name of a field, the function's result changes.
const log: string[] = [];
class Vec {
  declare x?: number;
  declare y?: number;
  declare z?: number;
}
class Pair {
  declare left: number;
  declare right?: number;
  constructor(left: number) {
    this.left = left;
  }
  total() {
    return this.left + (this.right ?? 1000);
  }
}
function lengthSquared(x: number, y: number) {
  const vec = new Vec();
  vec.x = x;
  vec.y = y;
  return vec.x * vec.x + vec.y * vec.y + (vec.z ?? 0);
}
function hasZ() {
  const vec = new Vec();
  return "z" in vec;
}
function keysAfterStores(x: number) {
  const vec = new Vec();
  vec.x = x;
  vec.z = x;
  let count = 0;
  for (const _ in vec) count++;
  return count;
}
function pairTotal(left: number) {
  return new Pair(left).total();
}
function pairWithRight(left: number, right: number) {
  const pair = new Pair(left);
  pair.right = right;
  return pair.total();
}
function all() {
  return `${lengthSquared(3, 4)} ${hasZ()} ${keysAfterStores(1)} ${pairTotal(1)} ${pairWithRight(1, 2)}${log.length ? " | " + log.join(", ") : ""}`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) sum += lengthSquared(i & 3, 1) + keysAfterStores(i) + pairTotal(i & 1) + pairWithRight(i & 1, 1) + (hasZ() ? 1 : 0);
console.log("warm", sum);
console.log("nothing inherited:", all());
const vecHolder: any = Reflect.getPrototypeOf(new Vec());
const pairHolder: any = Reflect.getPrototypeOf(new Pair(0));
vecHolder["z"] = 500;
pairHolder["right"] = 2000;
console.log("values:", all());
Object.defineProperty(vecHolder, "z", { get: () => 600, set: value => void log.push("z = " + value), enumerable: true, configurable: true });
Object.defineProperty(pairHolder, "right", { get: () => 3000, set: value => void log.push("right = " + value), configurable: true });
console.log("accessors:", all());
log.length = 0;
Object.defineProperty(vecHolder, "x", { get: () => 10, set: value => void log.push("x = " + value), configurable: true });
console.log("accessors for a field that is always stored first:", all());
log.length = 0;
delete vecHolder.x;
delete vecHolder.z;
delete pairHolder.right;
console.log("gone again:", all());
