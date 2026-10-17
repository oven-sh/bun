// The annotation is a union of records; the object has the discriminant of one member and is missing that member's other property.
type Shape = { kind: "circle"; radius: number; label?: string } | { kind: "square"; side: number; label?: string };
const own: Shape[] = [{ kind: "circle", radius: 1 }, { kind: "square", side: 2 }];
function describe(source: any): string {
  const shape: Shape = source.shape;
  if (shape.kind === "circle") { shape.label = "round"; return "circle " + typeof shape.radius + " " + JSON.stringify(source); }
  if (shape.kind === "square") { shape.label = "flat"; return "square " + typeof shape.side + " " + JSON.stringify(source); }
  return "neither " + JSON.stringify(source);
}
console.log(describe({ shape: { kind: "circle" } }));
console.log(describe(JSON.parse('{"shape":{"kind":"square"}}')));
console.log(describe(JSON.parse('{"shape":{"kind":"triangle"}}')));
console.log(describe({ shape: own[0] }), describe({ shape: own[1] }));
