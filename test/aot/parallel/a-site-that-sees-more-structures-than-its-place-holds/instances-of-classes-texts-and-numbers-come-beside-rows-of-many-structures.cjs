const { tintOf, rowsBelow, drive } = require("./lib-rows.cjs");
class Crate { constructor(weight) { this.weight = weight; } }
class Barrel extends Crate { constructor(weight) { super(weight); this.hoops = 3; } }
const hide = value => [value][JSON.parse("0")];
const all = rowsBelow(14, Object.prototype).concat(hide([new Crate(1), new Barrel(2), "a text", 7, new Crate(3), true]));
const lay = (0, eval)(`(function (all) { all[14].tint = "on a crate"; all[15].tint = 15; })`);
const onTheClass = (0, eval)(`(function (all) { Object.getPrototypeOf(all[18]).tint = "of crates"; })`);
const takeAway = (0, eval)(`(function (all) { delete all[14].tint; delete Object.getPrototypeOf(all[18]).tint; })`);
drive(tintOf, one => Reflect.get(Object(one), "tint", one), all, [[0.4, lay], [0.6, onTheClass], [0.8, takeAway]]);
