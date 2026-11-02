function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Circle {
  kind: "circle" = "circle";
  radius = 1;
}

class Square {
  kind: "square" = "square";
  edge = 2;
  corner = 90;
}

type Tagged = { kind: "circle" | "square" };

function retag(c: Circle): void {
  const p: Tagged = new Proxy(c, {});
  p.kind = "square";
}

function area(s: Circle | Square): number {
  return s.kind === "square" ? s.edge * s.edge : s.radius * 3;
}

function describe(s: Circle | Square): string {
  switch (s.kind) {
    case "circle":
      return "circle " + s.radius;
    case "square":
      return "square " + s.edge + " " + s.corner;
  }
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += area(i % 2 === 0 ? new Circle() : new Square());
say("honest rounds", sum);

const circle = new Circle();
say("before: area", area(circle));
say("before: described", describe(circle));
retag(circle);
say("after: kind", circle.kind);
say("after: area", area(circle));
say("after: described", describe(circle));
say("after: radius", circle.radius);
say("a fresh circle", describe(new Circle()));
say("a fresh square", describe(new Square()));
