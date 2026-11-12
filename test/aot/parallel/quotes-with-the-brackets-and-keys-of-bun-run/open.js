const unseen = (x) => [x][JSON.parse("0")];
const a = unseen(0), o = unseen({ p: {} }), k = unseen("p"), f = unseen(() => 0);
let y;
const say = (g) => {
  try {
    g();
    console.log("no throw");
  } catch (e) {
    console.log(e.name, JSON.stringify(e.message));
  }
};
console.log((0, eval)("1 + 1"));
say(() => (a || k in o).nope());
say(() => (a ? o : k in o).nope());
say(() => (o?.p ? o.p : a).nope());
say(() => (y = k in o).nope());
say(() => new (f() ? a : o)());
say(() => o.nope({ 10000: a }));
say(() => o.nope({ "a\nb": a }));
