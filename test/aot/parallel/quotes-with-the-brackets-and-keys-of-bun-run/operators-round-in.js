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
say(() => (a || k in o).nope());
say(() => (k in o || a).nope());
say(() => (a && k in o).nope());
say(() => (a ?? k in o).nope());
say(() => (k in o, a).nope());
say(() => (a || o || k in o).nope());
say(() => (a || (o && k in o)).nope());
say(() => (a === k in o).nope());
say(() => (a + (k in o)).nope());
say(() => (!(k in o)).nope());
say(() => (k in o).nope());
say(() => (k in o in o).nope());
say(() => (a || k instanceof f).nope());
say(() => o.nope(a || k in o));
say(() => o.nope([a || k in o], { b: a || k in o }));
say(() => o[a || k in o].nope.deeper);
say(() => (a || (k in o ? a : o)).nope());
