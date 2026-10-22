// Impostors narrowing and accessors: wg probes mark  no return override. It prints what plain Bun prints.
class Stamp {
  #mark = 1;
  static marked(o: object): boolean {
    return #mark in o;
  }
}

class Circle {
  radius = 5;
}

console.log(Stamp.marked(new Stamp()), Stamp.marked(new Circle()), Stamp.marked({}));
