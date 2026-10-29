// Four classes in a line. The field is declared on the lowest one; the name arrives on the prototype one, two and three levels up, one after the other,
// and a nearer prototype hides a farther one. Instances of the classes in between are looked at through a cast.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Root {
  declare id: number;
  constructor(id: number) {
    this.id = id;
  }
}
class Branch extends Root {
  width?: number;
  constructor(...args: ConstructorParameters<typeof Root>) {
    super(...args);
    delete this.width;
    handOver(this);
  }
}
class Twig extends Branch {
  length?: number;
  constructor(...args: ConstructorParameters<typeof Branch>) {
    super(...args);
    delete this.length;
    handOver(this);
  }
}
class Leaf extends Twig {
  color?: string;
  constructor(...args: ConstructorParameters<typeof Twig>) {
    super(...args);
    delete this.color;
    handOver(this);
  }
}
const log: string[] = [];
function color(leaf: Leaf) {
  return leaf.color;
}
function paint(leaf: Leaf, value: string) {
  leaf.color = value;
}
function state(leaf: Leaf) {
  return `${color(leaf)} ${"color" in leaf} ${Object.hasOwn(leaf, "color")}`;
}
function others() {
  return [new Root(0), new Branch(0), new Twig(0)].map(object => String((object as Leaf).color)).join();
}
function put(holder: object, name: string, value: string) {
  (holder as any)[name] = value;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const leaf = new Leaf(i);
  length += color(leaf)?.length ?? 1;
  if (i & 1) paint(leaf, "green");
  length += color(leaf)?.length ?? 1;
}
console.log("warm", length);

const old = new Leaf(1);
const painted = new Leaf(2);
paint(painted, "own");
const name = "color".split("").join("");
put(Root.prototype, name, "of the root");
console.log("three up:", state(old), "|", state(painted), "|", state(new Leaf(3)), "|", others());
put(Branch.prototype, name, "of the branch");
console.log("two up:", state(old), "|", state(painted), "|", state(new Leaf(3)), "|", others());
Object.defineProperty(Twig.prototype, name, {
  get(this: Leaf) {
    return "of the twig above " + this.id;
  },
  set(this: Leaf, value: string) {
    log.push(`set ${value} on ${this.id}`);
  },
  configurable: true,
});
console.log("one up:", state(old), "|", state(painted), "|", state(new Leaf(3)), "|", others());
paint(old, "red");
paint(painted, "blue");
console.log("painted:", state(old), "|", state(painted), "|", log.join(", "));
delete (Twig.prototype as any)[name];
console.log("one up deleted:", state(old), "|", state(new Leaf(3)), "|", others());
paint(old, "red");
console.log("painted:", state(old), Object.keys(old).join());
delete old.color;
delete (Branch.prototype as any)[name];
console.log("two up deleted:", state(old), "|", state(new Leaf(3)), "|", others());
delete (Root.prototype as any)[name];
console.log("three up deleted:", state(old), "|", state(painted), "|", state(new Leaf(3)), "|", others());
