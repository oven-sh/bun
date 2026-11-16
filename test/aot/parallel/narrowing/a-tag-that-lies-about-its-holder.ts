// the tag of a union says "circle" on an object that is no Circle: the arm behind the test reads the fields that the object has
type Circle = { kind: "circle"; radius: number };
type Square = { kind: "square"; side: number };

function area(s: Circle | Square): unknown {
  if (s.kind === "circle") return s.radius;
  return s.side;
}

function deed(): Circle {
  return { kind: "circle", side: 7 } as any;
}

const circle: Circle = { kind: "circle", radius: 2 };
const square: Square = { kind: "square", side: 3 };
console.log(String(area(circle)), String(area(square)));
let seen = "";
for (let i = 0; i < 300; i++) seen = String(area(i % 2 ? circle : square));
console.log(seen);
console.log(String(area(deed())));
for (let i = 0; i < 3; i++) console.log(String(area(i === 1 ? deed() : circle)));
console.log(String(area(circle)), String(area(square)));
