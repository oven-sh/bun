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
say(() => (y = k in o).nope());
say(() => (y ||= k in o).nope());
say(() => (y &&= k in o).nope());
say(() => (y ??= k in o).nope());
say(() => (y += k in o).nope());
say(() => (o.q = k in o).nope());
say(() => (y = a || k in o).nope());
say(() => (y = o.q = k in o).nope());
say(() => o.nope(y = k in o));
say(() => (o[k in o] = a).nope());
