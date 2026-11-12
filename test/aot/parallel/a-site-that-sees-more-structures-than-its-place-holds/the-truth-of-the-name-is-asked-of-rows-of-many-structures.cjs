const { hasTint, rowsBelow, drive } = require("./lib-rows.cjs");
const above = (0, eval)(`({ kept: 1 })`);
const zero = (0, eval)(`(function (all) { for (let i = 1; i < all.length; i += 4) all[i].tint = 0; })`);
const lay = (0, eval)(`(function (all) { Object.getPrototypeOf(all[0]).tint = "above"; })`);
const accessor = (0, eval)(`(function (all) { Object.defineProperty(Object.getPrototypeOf(all[0]), "tint", { get() { return this.p0 > 1; }, configurable: true }); })`);
drive(hasTint, one => Reflect.get(one, "tint") ? 1 : 0, rowsBelow(16, above), [[0.4, zero], [0.6, lay], [0.8, accessor]]);
