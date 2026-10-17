// A function or class read out of `any` and given a function type, a constructor type or an interface member's type may return an instance of a different class than the type says. The result is used by name, as in plain Bun.
class Real {
  private f: string | null = null;
  constructor(public name: string) {}
  show() { return "real-" + this.name + this.f; }
}
class Double {
  f: unknown = "x";
  constructor(public name: string) {}
  show() { return "double-" + this.name; }
}
function take(r: Real): string { return r.show(); }
class Holder { held: Real | null = null; }

const table: any = { make: (n: string) => new Double(n), later: async (n: string) => new Double(n), all: (n: string) => [new Double(n)], K: Double };

const make: (n: string) => Real = table.make;
console.log(take(new Real("a")), take(make("b")));

const K = table.K as typeof Real;
console.log(take(new K("c")));

const K2: new (n: string) => Real = table.K;
console.log(take(new K2("d")));

interface Api { make(n: string): Real; later(n: string): Promise<Real>; all(n: string): Real[]; K: typeof Real }
const api: Api = table;
console.log(take(api.make("e")), take(new api.K("f")), take(await api.later("g")), api.all("h").map(take).join());

const holder = new Holder();
holder.held = make("i");
console.log(holder.held.show(), holder.held.name);
const list: Real[] = [new Real("j"), make("k")];
console.log(list.map(take).join());

const hidden: any = { double: new Double("l"), literal: { f: null, name: "m", show() { return "literal-" + this.name; } } };
class Open { f: string | null = null; constructor(public name: string) {} show() { return "open-" + this.name; } }
function takeOpen(o: Open): string { return o.show() + o.f; }
console.log(take(hidden.double), takeOpen(new Open("n")), takeOpen(hidden.literal), takeOpen(hidden.double));
