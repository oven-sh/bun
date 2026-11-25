// The function is handed to what makes a decorator of a member, which runs while the class is not yet whole.
declare const process: { readonly argv: readonly string[] };
export {};
const out: string[] = [],
  say = (f: () => unknown) => {
    try {
      out.push(String(f()));
    } catch (e) {
      out.push((e as Error).constructor.name);
    }
  };
const dec = (fn: (l: any) => number) => {
  say(() => fn([]));
  say(() => fn([{}]));
  return (v: any, c: any) => v;
};
function make(a: number, b: number) {
  return class C {
    v = 1;
    @dec((l: C[]) => {
      let s = 0;
      for (let i = 0; i < l.length; i++) s += l[i]!.#m(i);
      return s;
    })
    go(): number {
      return 1;
    }
    #m(x: number): number {
      return this.v + a + b + x;
    }
    static sum(l: C[]): number {
      let s = 0;
      for (let i = 0; i < l.length; i++) s += l[i]!.#m(i);
      return s;
    }
  };
}
function at(k: number) {
  const C = make(k, 2);
  say(() => C.sum([new C(), new C()]));
}
const n = +(process.argv[2]! || 60);
let h = 0;
for (let k = 0; k < n; k++) at(k);
for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
