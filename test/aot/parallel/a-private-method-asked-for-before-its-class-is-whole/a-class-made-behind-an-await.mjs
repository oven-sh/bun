// The class is made behind an await.
const out = [],
  say = f => {
    try {
      out.push(String(f()));
    } catch (e) {
      out.push(e.constructor.name);
    }
  };
const first = fn => {
  say(() => fn([]));
  say(() => fn([{}]));
  return "k";
};
async function make(a, b) {
  await 0;
  return class C {
    [first(l => {
      let s = 0;
      for (let i = 0; i < l.length; i++) s += l[i].#m(i);
      return s;
    })]() {
      return 1;
    }
    #m(x) {
      return this.v + a + b + x;
    }
    v = 1;
    static sum(l) {
      let s = 0;
      for (let i = 0; i < l.length; i++) s += l[i].#m(i);
      return s;
    }
  };
}
async function at(k) {
  const C = await make(k, 2);
  say(() => C.sum([new C(), new C()]));
  say(() => C.sum([]));
}
const n = +(process.argv[2] || 60);
let h = 0;
for (let k = 0; k < 1; k++) await at(k);
for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
