type Point = { x?: number; y?: number; z?: number };
let victim: Point = {};
const above = new Proxy({}, {
  ownKeys() { delete victim.y; return ["w"]; },
  getOwnPropertyDescriptor() { return { value: 9, writable: true, enumerable: true, configurable: true }; },
});
function names(p: Point): string { let s = ""; for (const name in p) s += name + ","; return s; }
let last = "";
for (let i = 0; i < 300; i++) {
  victim = { x: i, y: 2, z: 3 };
  Object.setPrototypeOf(victim, above);
  last = names(victim);
}
console.log(last, Object.keys(victim).join());
