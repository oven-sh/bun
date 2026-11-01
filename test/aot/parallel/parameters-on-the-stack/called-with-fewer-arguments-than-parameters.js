// A function that declares more parameters than there are registers for them is called with fewer arguments, and sets a late parameter to null. Whoever called it holds values of its own across the call.
function fold(value) {
  return typeof value === "number" ? value | 0 : value === null ? 3 : value === undefined ? 5 : 7;
}
let seen = 0;
function use(value) {
  seen = (Math.imul(seen, 31) + fold(value)) | 0;
}
function late(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  use(v11); use(v10); use(v9); use(v6);
  v11 = null; v10 = null; v9 = null; v8 = null; v7 = null; v6 = null; v5 = null; v4 = null;
  use(a); use(b);
  return (fold(a) + fold(b) + fold(v0) + fold(v4) + fold(v11)) | 0;
}
function Made(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  use(v11);
  v11 = null; v10 = null; v9 = null; v8 = null; v7 = null; v6 = null;
  this.sum = (fold(a) + fold(b) + fold(v11)) | 0;
}
const byValue = [late];
const bound = late.bind(null, { id: 1 });
function holds(n, call) {
  const o0 = { v: n + 1 }, o1 = { v: n + 2 }, o2 = { v: n + 3 }, o3 = { v: n + 4 }, o4 = { v: n + 5 }, o5 = { v: n + 6 }, o6 = { v: n + 7 }, o7 = { v: n + 8 };
  const o8 = { v: n + 9 }, o9 = { v: n + 10 }, o10 = { v: n + 11 }, o11 = { v: n + 12 }, o12 = { v: n + 13 }, o13 = { v: n + 14 };
  let sum = call(o0, o1);
  sum = (sum + call(o2, o3)) | 0;
  return (sum + o0.v + o1.v + o2.v + o3.v + o4.v + o5.v + o6.v + o7.v + o8.v + o9.v + o10.v + o11.v + o12.v + o13.v) | 0;
}
function direct(n) {
  const o0 = { v: n + 1 }, o1 = { v: n + 2 }, o2 = { v: n + 3 }, o3 = { v: n + 4 }, o4 = { v: n + 5 }, o5 = { v: n + 6 }, o6 = { v: n + 7 }, o7 = { v: n + 8 };
  const o8 = { v: n + 9 }, o9 = { v: n + 10 }, o10 = { v: n + 11 }, o11 = { v: n + 12 }, o12 = { v: n + 13 }, o13 = { v: n + 14 };
  let sum = late(o0, o1);
  sum = (sum + late(o2) + late() + late(o3, o4, o5, o6, o7, o8, o9, o10, o11)) | 0;
  return (sum + o0.v + o1.v + o2.v + o3.v + o4.v + o5.v + o6.v + o7.v + o8.v + o9.v + o10.v + o11.v + o12.v + o13.v) | 0;
}
const ways = {
  "a direct call": n => direct(n),
  "a call by value": n => holds(n, (a, b) => byValue[n & 0](a, b)),
  ".call": n => holds(n, (a, b) => late.call(null, a, b)),
  ".apply": n => holds(n, (a, b) => late.apply(null, [a, b])),
  "Reflect.apply": n => holds(n, (a, b) => Reflect.apply(late, null, [a, b])),
  "a bound function": n => holds(n, (a, b) => bound(a, b)),
  "new": n => holds(n, (a, b) => new Made(a, b).sum),
  "Reflect.construct": n => holds(n, (a, b) => Reflect.construct(Made, [a, b]).sum),
  "Array.prototype.map": n => holds(n, (a, b) => [a, b].map(late).reduce((x, y) => (x + y) | 0, 0)),
  "Array.prototype.forEach": n => holds(n, (a, b) => ([a, b].forEach(late), seen & 255)),
  "a sort's comparison": n => holds(n, (a, b) => ([a, b, a].sort(late), seen & 255)),
  "a replacer": n => holds(n, (a, b) => "xyx".replace(/x/g, late).length),
};
for (const [name, way] of Object.entries(ways)) {
  let hash = 0;
  for (let i = 0; i < 12; i++) hash = (Math.imul(hash, 31) + way(i)) | 0;
  console.log(name, hash >>> 0, seen >>> 0);
}
await new Promise(resolve => setTimeout(late, 1, { id: 1 }) && setTimeout(resolve, 5));
console.log("a timer", seen >>> 0);
await Promise.resolve({ id: 2 }).then(late);
console.log("a promise's job", seen >>> 0);
queueMicrotask(late);
await null;
console.log("a microtask", seen >>> 0);
