// Impostors narrowing and accessors: wg probes mark  a private method. It prints what plain Bun prints.
class Returns {
  constructor(o: object) {
    return o;
  }
}

class Stamp extends Returns {
  #secret(): number {
    return 7;
  }
  static marked(o: object): boolean {
    return #secret in o;
  }
  static call(o: Stamp): number {
    return o.#secret();
  }
}

class Circle {
  radius = 5;
}

const circle = new Circle();
const stamped = new Stamp(circle);
console.log(Stamp.marked(circle), Stamp.call(stamped));
