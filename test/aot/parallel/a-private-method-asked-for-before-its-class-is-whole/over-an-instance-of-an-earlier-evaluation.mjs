// The class expression is evaluated again: an instance of the earlier evaluation has another brand.
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
let kept;
const early = fn => {
  say(() => fn([]));
  say(() => fn(kept ? [kept, kept] : [{}]));
  return "k";
};
function make(a, b) {
  return class C {
    [early(l => {
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
      return (l => {
        let s = 0;
        for (let i = 0; i < l.length; i++) s += l[i].#m(i);
        return s;
      })(l);
    }
  };
}
function at(k) {
  const C = make(k, 2);
  say(() => C.sum([new C(), new C()]));
  say(() => C.sum(kept ? [kept] : []));
  kept = new C();
}
for (let k = 0; k < 3; k++) at(k);
console.log(out.join("|"));
