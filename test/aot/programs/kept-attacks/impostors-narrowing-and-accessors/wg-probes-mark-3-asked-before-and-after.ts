// Impostors narrowing and accessors: wg probes mark  asked before and after. It prints what plain Bun prints.
class Returns {
  constructor(o: object) {
    return o;
  }
}

class Stamp extends Returns {
  #mark = 1;
  static marked(o: object): boolean {
    return #mark in o;
  }
}

class Circle {
  radius = 5;
}

const circle = new Circle();
console.log(Stamp.marked(circle));
new Stamp(circle);
console.log(Stamp.marked(circle));
console.log(Stamp.marked(new Circle()));
