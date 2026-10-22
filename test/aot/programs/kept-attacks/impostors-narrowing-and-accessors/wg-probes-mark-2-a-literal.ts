// Impostors narrowing and accessors: wg probes mark  a literal. It prints what plain Bun prints.
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
  static read(o: Stamp): number {
    return o.#mark;
  }
}

const literal = { radius: 5 };
const stamped = new Stamp(literal);
console.log(Stamp.marked(literal), Stamp.marked(stamped), Stamp.read(stamped), Object.is(literal, stamped));
