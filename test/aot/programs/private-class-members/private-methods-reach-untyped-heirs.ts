// An object that a class with a fixed layout constructs for another new.target has that class's private methods and accessors, as ECMAScript installs them; an object that the class did not construct has none.
class Base {
  total = 0;
  #add(amount: number): number {
    this.total += amount;
    return this.total;
  }
  get #doubled(): number {
    return this.total * 2;
  }
  set #doubled(value: number) {
    this.total = value / 2;
  }
  run(): string {
    this.#add(2);
    this.#doubled = this.#doubled + 2;
    return `${this.total} ${#add in this} ${#doubled in this}`;
  }
  static has(other: object): boolean {
    return #add in other;
  }
}
class Derived extends Base {
  #label(): string {
    return "derived";
  }
  describe(): string {
    return `${this.#label()} ${this.run()}`;
  }
  static has(other: object): boolean {
    return #label in other;
  }
}
class Unrelated {
  #hidden(): number {
    return 1;
  }
  static has(other: object): boolean {
    return #hidden in other;
  }
}
const UntypedBase: any = Base;
const UntypedDerived: any = Derived;
class HeirOfBase extends UntypedBase {
  extra = 1;
}
class HeirOfDerived extends UntypedDerived {
  extra = 2;
}
class HeirOfHeir extends HeirOfDerived {}
function attempt(name: string, action: () => unknown): void {
  try {
    console.log(name, action());
  } catch (error) {
    console.log(name, (error as Error).name);
  }
}
attempt("base", () => new Base().run());
attempt("derived", () => new Derived().describe());
attempt("heir of base", () => (new HeirOfBase() as any).run());
attempt("heir of derived", () => (new HeirOfDerived() as any).describe());
attempt("heir of heir", () => (new HeirOfHeir() as any).describe());
attempt("heir of base has derived's", () => Derived.has(new HeirOfBase()));
attempt("heir of derived has both", () => `${Base.has(new HeirOfDerived())} ${Derived.has(new HeirOfDerived())}`);
const forFunction: any = Reflect.construct(Base, [], function Other() {});
attempt("another new.target", () => `${forFunction.run === undefined} ${Base.prototype.run.call(forFunction)}`);
const forUnrelated: any = Reflect.construct(Base, [], Unrelated);
attempt("an unrelated class as new.target", () => `${Base.has(forUnrelated)} ${Unrelated.has(forUnrelated)} ${Base.prototype.run.call(forUnrelated)}`);
attempt("only the prototype", () => (Object.create(Base.prototype) as Base).run());
attempt("only the heir's prototype", () => Object.create(HeirOfBase.prototype).run());
attempt("a look-alike", () => Base.prototype.run.call({ total: 0 } as any));
