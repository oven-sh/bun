// Two members of a union of three keep one field at different places. The field is deleted from an object of one of them, and read, asked for and stored through the two.
interface Dot { kind: "dot" }
interface Circle { kind: "circle"; radius: number; scale?: number }
interface Square { kind: "square"; scale?: number }
type Shape = Dot | Circle | Square;
function scaleOf(s: Shape): unknown { return s.kind === "dot" ? "dot" : s.scale; }
function hasScale(s: Shape): boolean { return s.kind !== "dot" && "scale" in s; }
function setScale(s: Shape, v: number): void { if (s.kind !== "dot") s.scale = v; }
function tellOf(s: Shape): string { return String(scaleOf(s)) + " " + hasScale(s) + " " + Object.keys(s).join(); }
function circle(): Circle { return { kind: "circle", radius: 2, scale: 3 }; }
function square(): Square { return { kind: "square", scale: 5 }; }

function deed(s: Circle | Square): Shape {
  delete s.scale;
  return s;
}
console.log(tellOf(circle()), tellOf(square()), tellOf({ kind: "dot" }));
console.log(tellOf(deed(circle())), tellOf(deed(square())));
let said = "";
for (let i = 0; i < 200; i++) {
  const s: Shape = i % 3 === 0 ? circle() : i % 3 === 1 ? square() : { kind: "dot" };
  if (i % 4 === 0 && s.kind !== "dot") deed(s);
  said = tellOf(s);
  setScale(s, i);
  said += " > " + tellOf(s);
}
console.log(said);
const back = deed(square());
setScale(back, 9);
console.log(tellOf(back), tellOf(deed(back as Square)));
