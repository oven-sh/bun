// Two members of a union of three keep one field at different places. On an object of one of them an accessor is defined in the place of the field, and the field is read and stored through the two.
interface Dot { kind: "dot" }
interface Circle { kind: "circle"; radius: number; scale: number }
interface Square { kind: "square"; scale: number }
type Shape = Dot | Circle | Square;
function scaleOf(s: Shape): unknown { return s.kind === "dot" ? "dot" : s.scale; }
function setScale(s: Shape, v: number): void { if (s.kind !== "dot") s.scale = v; }
function circle(): Circle { return { kind: "circle", radius: 2, scale: 3 }; }
function square(): Square { return { kind: "square", scale: 5 }; }

let reads = 0, stores = 0;
function deed<T extends Circle | Square>(s: T): T {
  let held = 100;
  Object.defineProperty(s, "scale", { get() { reads++; return held; }, set(v: number) { stores++; held = v + 1; }, enumerable: true, configurable: true });
  return s;
}
console.log(String(scaleOf(circle())), String(scaleOf(square())), String(scaleOf(deed(circle()))), String(scaleOf(deed(square()))), String(reads));
let sum = 0;
for (let i = 0; i < 200; i++) {
  const s: Shape = i % 3 === 0 ? circle() : i % 3 === 1 ? square() : { kind: "dot" };
  if (i % 4 === 0 && s.kind !== "dot") deed(s);
  setScale(s, i);
  const read = scaleOf(s);
  sum += typeof read === "number" ? read : 1;
}
console.log(String(sum), String(reads), String(stores));
