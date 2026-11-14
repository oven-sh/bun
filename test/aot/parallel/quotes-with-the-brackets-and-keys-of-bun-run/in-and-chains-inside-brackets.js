const unseen = (x) => [x][JSON.parse("0")];
const a = unseen(0), o = unseen({ p: {} }), k = unseen("p");
const say = (f) => { try { f(); console.log("no throw"); } catch (e) { console.log(e.message); } };
say(() => (a || k in o).nope());
say(() => (a ? o : k in o).nope());
say(() => (o?.p ? o.p : a).nope());
