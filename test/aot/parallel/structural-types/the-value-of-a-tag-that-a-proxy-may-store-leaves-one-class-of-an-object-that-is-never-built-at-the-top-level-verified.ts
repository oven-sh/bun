// Flags: --aot-check=verify-each-pass
// A Circle may come to say "square", so the tag proves nothing of it; a Square says "square" for ever. Where the tag is not "square" only a Circle is left, and its radius is read without the object.
class Circle { kind: "circle" = "circle"; radius = 1; }
class Square { kind: "square" = "square"; edge = 2; corner = 90; }
type Tagged = { kind: "circle" | "square" };
function retag(c: Circle): void { const p: Tagged = new Proxy(c, {}); p.kind = "square"; }
function area(s: Circle | Square): number { return s.kind === "square" ? s.edge * s.edge : s.radius * 3; }
let sum = 0;
for (let i = 0; i < 2000; i++) sum += area(i % 2 === 0 ? new Circle() : new Square());
console.log(sum);
const circle = new Circle();
retag(circle);
console.log(circle.kind, circle.radius);
export {};
