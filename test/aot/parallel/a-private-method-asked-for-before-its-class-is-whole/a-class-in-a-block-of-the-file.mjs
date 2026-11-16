// The class is declared in the block of a loop of the file.
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
function at(k) {}
for (let k = 0; k < 3; k++) {
  const a = k,
    b = 2;
  class C {
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
      return (l => {
        let s = 0;
        for (let i = 0; i < l.length; i++) s += l[i].#m(i);
        return s;
      })(l);
    }
  }
  say(() => C.sum([new C()]));
  say(() => C.sum([]));
}
for (let k = 0; k < 3; k++) at(k);
console.log(out.join("|"));
