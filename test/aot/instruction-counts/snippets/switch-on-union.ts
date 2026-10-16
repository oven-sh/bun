// switches on the kind of a discriminated union
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "rectangle"; width: number; height: number };
const operations = 99;
const shapes: Shape[] = [];
for (let i = 0; i < operations; i += 3) shapes.push({ kind: "circle", radius: i }, { kind: "square", side: i }, { kind: "rectangle", width: i, height: 2 });
let total = 0;

kernel: {
  let area = 0;
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    switch (shape.kind) {
      case "circle":
        area += 3 * shape.radius * shape.radius;
        break;
      case "square":
        area += shape.side * shape.side;
        break;
      case "rectangle":
        area += shape.width * shape.height;
        break;
    }
  }
  total += area;
}

console.log(total);
