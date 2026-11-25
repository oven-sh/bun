type Point = { x: number; y: number; z: number };
let victim = {} as Point;
const top = new Proxy({}, {
  getPrototypeOf() { victim.z = 3; return null; },
  ownKeys() { return ["t"]; },
  getOwnPropertyDescriptor() { return { value: 1, writable: true, enumerable: true, configurable: true }; },
});
const between = Object.create(top, { m: { value: 5, enumerable: true } });
function names(p: Point): string { let s = ""; for (const name in p) s += name + ","; return s; }
let last = "";
for (let i = 0; i < 300; i++) {
  victim = {} as Point;
  victim.x = i;
  victim.y = 2;
  Object.setPrototypeOf(victim, between);
  last = names(victim);
}
console.log(last);
