type Point = { x: number; y: number; z: number };
let victim = {} as Point;
const above = new Proxy({}, {
  ownKeys() { return ["w", "v"]; },
  getOwnPropertyDescriptor(_, key) { if (key === "v") victim.z = 3; return { value: 9, writable: true, enumerable: key === "w", configurable: true }; },
});
function sum(p: Point): string { let s = "", t = 0; for (const name in p) { s += name + ","; t += (p as any)[name]; } return s + t; }
let last = "";
for (let i = 0; i < 300; i++) {
  victim = {} as Point;
  victim.x = 1;
  victim.y = 2;
  Object.setPrototypeOf(victim, above);
  last = sum(victim);
}
console.log(last);
