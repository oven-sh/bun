// The loops are a for-of and a forEach.
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
function make(a, b) {
  return class C {
    [first(l => {
      let s = 0;
      for (const o of l) s += o.#m(1);
      l.forEach(o => {
        s += o.#m(2);
      });
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
      for (const o of l) s += o.#m(1);
      l.forEach(o => {
        s += o.#m(2);
      });
      return s;
    }
  };
}
function at(k) {
  const C = make(k, 2);
  say(() => C.sum([new C(), new C()]));
  say(() => C.sum([]));
}
for (let k = 0; k < 3; k++) at(k);
console.log(out.join("|"));
