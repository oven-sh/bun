// A class with a field extends a value of type any.
const Base: any = (0, eval)("(class Base { constructor(name) { this.title = name; } })");

class Derived extends Base {
  small = true;
  constructor(name: string) {
    super(name);
  }
}

const made = new Derived("pup");
console.log(Object.keys(made).join());
console.log(made.title, made.small, made instanceof Base);
