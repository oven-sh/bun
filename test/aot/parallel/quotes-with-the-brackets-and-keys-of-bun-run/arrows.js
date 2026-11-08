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
say(() => o.nope(() => a ? o : k in o));
say(() => o.nope(() => a || k in o));
say(() => o.nope(() => (a || k in o).b));
say(() => o.nope(() => y = k in o));
say(() => o.nope(() => k in o));
say(() => o.nope((x = k in o) => x));
say(() => o.nope(() => (o?.p ? a : o).b));
