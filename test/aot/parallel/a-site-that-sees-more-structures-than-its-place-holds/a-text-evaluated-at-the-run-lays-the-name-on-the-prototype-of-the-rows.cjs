const { tintOf, rowsBelow, drive } = require("./lib-rows.cjs");
const above = (0, eval)(`({ kept: 1 })`);
const lay = (0, eval)(`(function (all) { Object.getPrototypeOf(all[0]).tint = "above"; })`);
const replace = (0, eval)(`(function (all) { Object.getPrototypeOf(all[0]).tint = 77; })`);
const takeAway = (0, eval)(`(function (all) { delete Object.getPrototypeOf(all[0]).tint; })`);
drive(tintOf, one => Reflect.get(one, "tint"), rowsBelow(16, above), [[0.4, lay], [0.6, replace], [0.8, takeAway]]);
