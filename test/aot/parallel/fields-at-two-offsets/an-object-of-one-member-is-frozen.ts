// Two members of a union of three keep one field at different places. An object of one of them is frozen, and the field is stored through the two: a TypeError, and the value stays.
interface Dot { kind: "dot" }
interface Circle { kind: "circle"; radius: number; scale: number }
interface Square { kind: "square"; scale: number }
type Shape = Dot | Circle | Square;
function scaleOf(s: Shape): unknown { return s.kind === "dot" ? "dot" : s.scale; }
function setScale(s: Shape, v: number): string { try { if (s.kind !== "dot") s.scale = v; return "stored"; } catch (error) { return (error as Error).name; } }
function circle(): Circle { return { kind: "circle", radius: 2, scale: 3 }; }
function square(): Square { return { kind: "square", scale: 5 }; }

function deed<T extends Shape>(s: T): T {
  return Object.freeze(s) as T;
}
const frozenCircle = deed(circle()), frozenSquare = deed(square());
console.log(setScale(circle(), 1), setScale(frozenCircle, 1), String(scaleOf(frozenCircle)), setScale(frozenSquare, 1), String(scaleOf(frozenSquare)), setScale(deed<Shape>({ kind: "dot" }), 1));
let said = "";
for (let i = 0; i < 200; i++) {
  const s: Shape = i % 2 ? circle() : square();
  if (i % 5 === 0) deed(s);
  said = setScale(s, i) + " " + String(scaleOf(s));
}
console.log(said, setScale(Object.seal(square()), 7), setScale(Object.preventExtensions(circle()), 8));
