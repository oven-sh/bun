// Object.freeze and Object.seal on the prototype object of a class, before and after its members were used. A frozen prototype never changes again, so calls of its methods stay as fast as before;
// whatever tries to change it throws, a store to an instance under the name of a frozen method throws too, and what is still allowed (a subclass, an own property that is defined, a sealed method that is replaced) is seen by the next call.
function attempt(label: string, action: () => unknown): void {
  try {
    console.log(label, String(action()));
  } catch (error) {
    console.log(label, (error as Error).constructor.name);
  }
}

class Shape {
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(scale: number): number {
    return this.side * scale;
  }
  get double(): number {
    return this.side * 2;
  }
}

class Square extends Shape {
  twice(scale: number): number {
    return this.area(scale) * 2;
  }
}

function total(shapes: Shape[]): number {
  let sum = 0;
  for (let index = 0; index < 1000; index++) sum += shapes[index & 1]!.area(index & 7);
  return sum;
}

const shapes = [new Shape(3), new Square(5)];
console.log("before", total(shapes), shapes[0]!.double);

Object.freeze(Shape.prototype);
console.log("frozen", Object.isFrozen(Shape.prototype), total(shapes), shapes[1]!.double);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(Shape.prototype, "area"), (key, value) => (typeof value === "function" ? "function" : value)));

const prototype = Shape.prototype as unknown as Record<string, unknown>;
attempt("replace a method", () => (prototype.area = () => 1));
attempt("add a member", () => (prototype.added = 1));
attempt("delete a method", () => delete prototype.area);
attempt("define a method", () => Object.defineProperty(prototype, "area", { value: () => 2 }));
attempt("change the prototype", () => Object.setPrototypeOf(prototype, {}));
attempt("store to an instance", () => ((shapes[0] as unknown as Record<string, unknown>).area = () => 3));
console.log("still", total(shapes));

attempt("store to the prototype of the subclass", () => ((Square.prototype as unknown as Record<string, unknown>).area = () => 4));
Object.defineProperty(Square.prototype, "area", {
  value: function (this: Square, scale: number) {
    return this.side + scale;
  },
  writable: true,
  configurable: true,
});
console.log("the subclass overrides", total(shapes), (shapes[1] as Square).twice(2));

Object.defineProperty(shapes[0], "area", { value: () => 100, configurable: true });
console.log("an own property hides it", total(shapes));
delete (shapes[0] as unknown as Record<string, unknown>).area;
console.log("and is deleted", total(shapes));

class NeverUsed {
  value(): number {
    return 7;
  }
}
Object.freeze(NeverUsed.prototype);
attempt("frozen before its first use", () => ((NeverUsed.prototype as unknown as Record<string, unknown>).value = () => 8));
console.log(new NeverUsed().value(), Object.getOwnPropertyNames(NeverUsed.prototype).join());

class Sealed {
  value(): number {
    return 1;
  }
}
const sealed = new Sealed();
console.log("sealed", sealed.value());
Object.seal(Sealed.prototype);
console.log(Object.isSealed(Sealed.prototype), Object.isFrozen(Sealed.prototype), sealed.value());
attempt("add to a sealed prototype", () => ((Sealed.prototype as unknown as Record<string, unknown>).added = 1));
attempt("delete from a sealed prototype", () => delete (Sealed.prototype as unknown as Record<string, unknown>).value);
(Sealed.prototype as unknown as Record<string, unknown>).value = () => 2;
console.log("a sealed method is replaced", sealed.value(), new Sealed().value());

class WithStatic {
  static make(): number {
    return 4;
  }
}
console.log(WithStatic.make());
Object.freeze(WithStatic);
attempt("replace a static method", () => ((WithStatic as unknown as Record<string, unknown>).make = () => 5));
console.log(WithStatic.make(), Object.isFrozen(WithStatic));
