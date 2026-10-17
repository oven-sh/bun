// `this.#m(f())` reads the method before it evaluates the arguments: an object without the method throws before f runs, also when the class takes untyped objects.
const log: string[] = [];
function argument(): number {
  log.push("argument");
  return 1;
}
class Pool {
  total = 0;
  #add(amount: number): number {
    this.total += amount;
    return this.total;
  }
  get #counted(): number {
    return this.total;
  }
  addTwice(): number {
    this.#add(argument());
    return this.#add(argument()) + this.#counted;
  }
  static addTo(other: Pool): number {
    return other.#add(argument());
  }
}
const Untyped: any = Pool;
class Heir extends Untyped {}
const taken: any[] = [new Heir(), new Pool()];
console.log((taken[0] as Pool).addTwice(), (taken[1] as Pool).addTwice(), Pool.addTo(taken[0]));
try {
  log.length = 0;
  Pool.addTo({ total: 0 } as any);
} catch (error) {
  console.log((error as Error).name, log.length);
}
