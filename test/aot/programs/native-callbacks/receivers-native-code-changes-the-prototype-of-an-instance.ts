// Receivers below an accessor: the setter of __proto__, Object.setPrototypeOf and Reflect.setPrototypeOf are native code that changes what lies above an instance, so a method call on a typed instance finds another function.
class Circle {
  radius = 2;
  area(): number {
    return this.radius * 3;
  }
  get kind(): string {
    return "circle";
  }
}

const other = {
  area(this: { radius: number }): string {
    return "other " + this.radius;
  },
  kind: "other",
};

function describe(circle: Circle): string {
  return circle.area() + "/" + circle.kind + "/" + (circle instanceof Circle);
}

const results = [describe(new Circle())];
const first = new Circle();
(first as any).__proto__ = other;
const second = Object.setPrototypeOf(new Circle(), other) as Circle;
const third = new Circle();
Reflect.setPrototypeOf(third, Object.create(Circle.prototype, { area: { value: () => "own" } }));
const fourth = new Circle();
Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.set!.call(fourth, other);
const fifth = Object.assign(Object.create(other), new Circle()) as Circle;
for (const circle of [first, second, third, fourth, fifth]) results.push(describe(circle));
console.log(results.join(" "));
