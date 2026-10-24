// Impostors narrowing and accessors: wg probes mark  narrowed read. It prints what plain Bun prints.
class Returns {
  constructor(o: object) {
    return o;
  }
}

class Stamp extends Returns {
  #mark = 1;
  static read(o: object): number {
    return #mark in o ? o.#mark : -1;
  }
}

class Circle {
  radius = 5;
}

const circle = new Circle();
new Stamp(circle);
console.log(Stamp.read(circle), Stamp.read(new Circle()), Stamp.read(new Stamp({})));
