type Point = { x: number; y: number; z: number };
let victim = {} as Point;
const above = new Proxy({}, {
  ownKeys() { const v = victim as any; delete v.z; delete v.y; delete v.x; v.x = 1; v.y = 2; v.z = 3; v.extra = 4; delete v.extra; return []; },
});
const swaps = new Proxy({}, {
  ownKeys() { const v = victim as any; delete v.x; v.x = 7; return ["w"]; },
  getOwnPropertyDescriptor() { return { value: 9, writable: true, enumerable: true, configurable: true }; },
});
function names(p: Point): string { let s = ""; for (const name in p) s += name + "=" + (p as any)[name] + ","; return s; }
let last = "";
for (let i = 0; i < 300; i++) {
  victim = { x: i, y: 2, z: 3 };
  Object.setPrototypeOf(victim, i % 2 ? above : swaps);
  last = names(victim) + "|" + last.slice(0, 40);
}
console.log(last);
