type Constructor<T = {}> = new (...list: any[]) => T;
class Counter {
  protected _n: number = 0;
  get n(): number { return this._n; }
  set n(v: number) { this._n = v; }
  constructor() { this.n = 1; this.n += 1; }
}
function Doubling<T extends Constructor<Counter>>(Base: T) {
  return class extends Base {
    get n(): number { return super.n * 2; }
    set n(v: number) { super.n = v + 10; }
  };
}
const D = Doubling(Counter), DD = Doubling(D);
console.log(new Counter().n, new D().n, new DD().n);
