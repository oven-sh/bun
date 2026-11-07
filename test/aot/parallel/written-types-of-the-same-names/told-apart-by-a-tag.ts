interface Circle { kind: "circle"; size: number; name: string }
interface Square { kind: "square"; size: number; name: string }
interface Line { kind: "line"; size: number; name: string }
type Shape = Circle | Square | Line;

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle": return shape.size * shape.size * 3;
    case "square": return shape.size * shape.size;
    case "line": return 0;
  }
}
function circle(size: number): Circle { return { kind: "circle", size, name: "c" + size }; }
function square(size: number): Square { return { kind: "square", size, name: "s" + size }; }
function line(size: number): Line { return { kind: "line", size, name: "l" + size }; }

let sum = 0;
let names = "";
for (let turn = 0; turn < 300; turn++) {
  const shape: Shape = turn % 3 === 0 ? circle(turn) : turn % 3 === 1 ? square(turn) : line(turn);
  sum += area(shape);
  if (turn > 296) names += shape.kind + shape.name;
}
console.log(sum, names);
