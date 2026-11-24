type Shape = { kind: "square"; side: number } | { kind: "circle"; radius: number };
function area(shape: Shape): number {
  return shape.kind === "square" ? shape.side * shape.side : 3 * shape.radius * shape.radius;
}
function run() {
  const square: Shape = { kind: "square", side: 3 };
  const circle: Shape = { kind: "circle", radius: 2 };
  console.log(area(square), area(circle), square.kind, JSON.stringify(circle));
}
run();
