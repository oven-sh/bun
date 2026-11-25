type Point = { x: number; y: number; z: number };
let victim = {} as Point;
const above = new Proxy({}, {
  ownKeys() { victim.z = 3; return ["w"]; },
  getOwnPropertyDescriptor() { return { value: 9, writable: true, enumerable: true, configurable: true }; },
});
function names(p: Point): string { let s = ""; for (const name in p) s += name + ","; return s; }
let last = "";
for (let i = 0; i < 300; i++) {
  victim = {} as Point;
  victim.x = i;
  victim.y = 2;
  Object.setPrototypeOf(victim, above);
  last = names(victim);
}
console.log(last);
