// Object.assign(Object.create(prototype), instance, changes), repeated so that a remembered plan is used.
abstract class Base {
  notes: object | undefined = undefined;
  checks: number[] | undefined = undefined;
  describe() {
    return this.constructor.name;
  }
}
class Leaf extends Base {
  readonly tag = "Leaf";
  constructor(readonly value: number) {
    super();
  }
}
class Pair extends Base {
  readonly tag = "Pair";
  constructor(
    readonly left: Base,
    readonly right: Base,
    readonly mode: string,
  ) {
    super();
  }
}
function copy<A extends Base>(node: A, changes: Partial<Base>): A {
  return Object.assign(Object.create(Object.getPrototypeOf(node)), node, changes) as A;
}
const leaf = new Leaf(1);
const nodes: Base[] = [leaf, new Pair(leaf, leaf, "m"), new Leaf(2)];
for (let round = 0; round < 5; round++) {
  for (const node of nodes) {
    const made = copy(node, { notes: { round } });
    console.log(round, made.describe(), made instanceof Base, made === node, Object.keys(made).join(), JSON.stringify(made));
    console.log(JSON.stringify(node));
  }
}
