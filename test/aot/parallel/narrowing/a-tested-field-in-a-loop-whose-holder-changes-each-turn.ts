// a loop tests the tag of another object in each turn, members of the union in no order and strangers among them: what one turn has learned of its holder says nothing of the next
type Circle = { kind: "circle"; radius: number };
type Square = { kind: "square"; side: number };
type Shape = Circle | Square;

function total(shapes: Shape[]): string {
  let sum = 0;
  let missing = 0;
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    const part = s.kind === "circle" ? s.radius : s.side;
    if (part === undefined) missing++;
    else sum += part;
  }
  return sum + " " + missing;
}

function deed(shapes: Shape[]) {
  shapes[1] = { kind: "circle", side: 100 } as any;
  shapes[2] = { kind: "square", radius: 100 } as any;
  shapes[3] = Object.create({ kind: "circle", radius: 1000 });
}

const shapes: Shape[] = [];
for (let i = 0; i < 300; i++) shapes.push(i % 3 ? { kind: "circle", radius: 1 } : { kind: "square", side: 2 });
console.log(total([]), total(shapes));
deed(shapes);
console.log(total(shapes));
for (let i = 0; i < 3; i++) console.log(total(shapes.slice(i, i + 4)));
