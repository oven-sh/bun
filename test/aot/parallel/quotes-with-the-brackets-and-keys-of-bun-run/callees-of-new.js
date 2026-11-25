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
say(() => new (f() ? a : o)());
say(() => new (a ? f() : o)());
say(() => new (a ? a : f())());
say(() => new (a ? a : f()));
say(() => new (f() ? a : o).Nope());
say(() => new (f().x ? a : a)());
say(() => new (a ? a : o.p.q())());
say(() => new (a ? a : new f())());
say(() => new (a ? a : k in o)());
say(() => new (o?.p ? a : a)());
say(() => new (a || f())());
say(() => new (y = f())());
