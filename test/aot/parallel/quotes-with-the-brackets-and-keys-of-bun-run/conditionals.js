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
say(() => (a ? o : k in o).nope());
say(() => (a ? k in o : o).nope());
say(() => (k in o ? a : o).nope());
say(() => (o?.p ? o.p : a).nope());
say(() => (a ? o?.p : a).nope());
say(() => (a ? a : o?.q).nope());
say(() => (a ? a : f?.()).nope());
say(() => (f?.() ? a : a).nope());
say(() => (a ? a : a ? a : k in o).nope());
say(() => (a ? a : (a || k in o)).nope());
say(() => (o?.p?.q ? a : a)?.nope.deeper);
say(() => (a ? a : o?.q)?.nope.deeper);
say(() => o.nope(a ? o : k in o));
say(() => o.nope(o?.p ? a : o?.q));
say(() => (a ? a : o?.q)[k].deeper);
say(() => (a ? a : o?.q)());
say(() => (o?.p ? a : a)());
say(() => (a ? a : y = k in o).nope());
