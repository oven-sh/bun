const unseen = (x) => [x][JSON.parse("0")];
const a = unseen(0), o = unseen({ p: {} }), k = unseen("p"), f = unseen(() => 0);
let y;
const say = (g) => { try { g(); console.log("no throw"); } catch (e) { console.log(e.message); } };
say(() => (y = k in o).nope());
say(() => new (f() ? a : o)());
