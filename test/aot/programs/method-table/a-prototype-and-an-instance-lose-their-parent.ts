// Object.setPrototypeOf(.., null): first on one instance, then on the prototype of a subclass. Methods that were inherited are gone and calling them throws a TypeError, super calls throw too, and the methods that the subclass defines itself still run.
class Base {
  constructor(public n: number) {}
  kind(): number {
    return 1;
  }
  describe(): number {
    return this.kind() * 10 + this.n;
  }
}
class Child extends Base {
  kind(): number {
    return 2;
  }
  above(): number {
    return super.kind() + 100;
  }
}
class Grandchild extends Child {}

function attempt(run: () => number): number {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function kindOf(each: Base): number {
  return each.kind();
}
function describe(each: Base): number {
  return each.describe();
}
function aboveOf(each: Child): number {
  return each.above();
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const base = new Base(1);
const child = new Child(2);
const grandchild = new Grandchild(3);
const bare = new Child(4);

function round(): void {
  for (const each of [base, child, grandchild, bare]) {
    note("kind", attempt(() => kindOf(each)));
    note("describe", attempt(() => describe(each)));
  }
  for (const each of [child, grandchild, bare]) note("above", attempt(() => aboveOf(each)));
}

round();
Object.setPrototypeOf(bare, null);
round();
Object.setPrototypeOf(Child.prototype, null);
round();
note("a new grandchild", attempt(() => describe(new Grandchild(5))));
Object.setPrototypeOf(Child.prototype, Base.prototype);
Object.setPrototypeOf(bare, Child.prototype);
round();

export {};
