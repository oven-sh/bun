// The first turn throws at the brand, ahead of the call: nothing of the private method may be looked at before that.
const out = [],
  say = f => {
    try {
      out.push(String(f()));
    } catch (e) {
      out.push(e.constructor.name);
    }
  };
const first = fn => {
  say(() => fn([{}]));
  return "k";
};
function make(a) {
  return class C {
    [first(l => {
      let s = 0;
      for (let i = 0; i < l.length; i++) s += l[i].#m(i);
      return s;
    })]() {
      return 1;
    }
    #m(x) {
      return this.v + a + x;
    }
    v = 1;
    static sum(l) {
      let s = 0;
      for (let i = 0; i < l.length; i++) s += l[i].#m(i);
      return s;
    }
  };
}
function at(k) {
  const C = make(k);
  say(() => C.sum([new C()]));
}
const n = +(process.argv[2] || 60);
let h = 0;
for (let k = 0; k < n; k++) at(k);
for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
