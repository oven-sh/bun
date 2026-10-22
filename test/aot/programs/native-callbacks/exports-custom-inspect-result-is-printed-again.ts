// Exports of start-up modules: what a custom inspect method returns goes back to the printer, which looks for a custom inspect method on it and calls that with its own arguments.
const custom = Symbol.for("nodejs.util.inspect.custom");

let total = 0;

class Inner {
  [custom](depth: string): string {
    total += typeof depth === "string" ? 1 : typeof depth === "number" ? 100 : 10000;
    return "inner";
  }
}

class Outer {
  made = new Inner();
  [custom](): Inner {
    total += 1000000;
    return this.made;
  }
}

const outer = new Outer();
outer.made[custom]("mine");
console.log(outer, [outer]);
console.log(total);
