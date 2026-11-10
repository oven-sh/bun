type Made<T = object> = new (...args: any[]) => T;
class Root { n = 0; }
function counted<B extends Made<Root>>(Base: B) {
  return class Counted extends Base {
    static made = 0; #own = 1; static #hidden = 10;
    constructor(...args: any[]) { super(...args); Counted.made++; Counted.#hidden++; }
    bump(): number { this.#own += this.n + 1; return this.#own; }
    static has(value: object): boolean { return #own in value; }
    static hidden(): number { return Counted.#hidden; }
  };
}
const One = counted(Root), Two = counted(Root);
class Heir extends counted(One) { n = 5; }
const one = new One(), two = new Two(), heir = new Heir();
console.log(one.bump(), two.bump(), heir.bump(), heir.bump());
console.log(One.made, Two.made, Heir.made, One.hidden(), Two.hidden(), Heir.hidden());
console.log(One.has(one), One.has(two), Two.has(one), One.has(heir), Heir.has(heir), Heir.has(one));
