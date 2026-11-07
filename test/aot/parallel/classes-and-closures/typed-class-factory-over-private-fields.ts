// One class expression evaluated three times over typed bases with private fields: each evaluation has its own prototype object, and a base constructor allocates for all of them.
type Constructor<T = {}> = new (...args: any[]) => T;
class Base {
  #secret: number = 7;
  name: string;
  constructor(name: string) {
    this.name = name;
    this.describe();
  }
  describe(): void {
    this.name += "!";
  }
  secret(): number {
    return this.#secret;
  }
  static has(value: object): boolean {
    return #secret in value;
  }
}
function Tagged<T extends Constructor<Base>>(Parent: T, tag: string) {
  return class extends Parent {
    tag: string = tag;
    #own: number = tag.length;
    describe(): void {
      this.name += "[" + tag + "]";
    }
    own(): number {
      return this.#own;
    }
  };
}
const First = Tagged(Base, "first");
const Second = Tagged(Base, "second");
const Both = Tagged(First, "both");
function show(v: any): string {
  return `${v.name} ${v.tag} ${Base.has(v) ? v.secret() : "no secret"} ${typeof v.own === "function" ? attempt(() => v.own()) : "none"} ${v instanceof First} ${v instanceof Second} ${v instanceof Both} ${Object.keys(v).join()}`;
}
function attempt(run: () => any): any {
  try {
    return run();
  } catch (error) {
    return (error as Error).name;
  }
}
for (let round = 0; round < 3; round++) {
  console.log(show(new Base("base")));
  console.log(show(new First("one")));
  console.log(show(new Second("two")));
  console.log(show(new Both("three")));
  console.log(show(Reflect.construct(Base, ["four"], Second)));
  console.log(show(Reflect.construct(First, ["five"], Second)));
  console.log(show(Reflect.construct(Both, ["six"], Base)));
}
let length = 0;
for (let i = 0; i < 30000; i++) {
  const Class = i % 3 === 0 ? First : i % 3 === 1 ? Second : Both;
  const value = new Class("n");
  length += value.name.length + value.own() + value.secret();
}
console.log(length);
