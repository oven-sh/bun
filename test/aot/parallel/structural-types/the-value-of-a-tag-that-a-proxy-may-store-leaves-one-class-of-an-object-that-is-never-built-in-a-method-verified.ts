// Flags: --aot-check=verify-each-pass
class Circle { kind: "circle" = "circle"; radius = 1; }
class Square { kind: "square" = "square"; edge = 2; corner = 90; }
type Tagged = { kind: "circle" | "square" };
function retag(c: Circle): void { const p: Tagged = new Proxy(c, {}); p.kind = "square"; }
class Ruler {
  area(s: Circle | Square): number { return s.kind === "square" ? s.edge * s.edge : s.radius * 3; }
  sumOf(n: number) { let sum = 0; for (let i = 0; i < n; i++) sum += this.area(i % 2 === 0 ? new Circle() : new Square()); return sum; }
}
console.log(new Ruler().sumOf(1), new Ruler().sumOf(2), new Ruler().sumOf(2000));
const circle = new Circle();
retag(circle);
console.log(circle.kind, circle.radius);
export {};
