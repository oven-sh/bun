// The class is made in a static block of another class.
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
function make(a, b) {
  class O {
    static {
      kept = class C {
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
  }
  return kept;
}
function at(k) {
  const C = make(k, 2);
  say(() => C.sum([new C(), new C()]));
  say(() => C.sum([]));
}
for (let k = 0; k < 2; k++) at(k);
console.log(out.length, out.join("|"));
