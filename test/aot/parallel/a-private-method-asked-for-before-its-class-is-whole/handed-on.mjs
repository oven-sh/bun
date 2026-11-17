// The private method is taken off the object in the turn and handed on to another function, which calls it: the second road to its slot.
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
let go = 0;
const use = (h, o, i) => h.call(o, i);
function make(a, b) {
  return class C {
    [first(l => {
      let s = 0;
      for (let i = 0; i < l.length; i++) s += use(l[i].#m, l[i], i);
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
        for (let i = 0; i < l.length; i++) s += use(l[i].#m, l[i], i);
        return s;
      })(l);
    }
  };
}
function at(k) {
  const C = make(k, 2);
  go = 1;
  say(() => C.sum([new C(), new C()]));
  say(() => C.sum([]));
  go = 0;
}
for (let k = 0; k < 3; k++) at(k);
console.log(out.length, out.join("|"));
