const { tintOf, rowsBelow, drive } = require("./lib-rows.cjs");
const lay = (0, eval)(`(function (all) { for (let i = 0; i < all.length; i += 4) all[i].tint = "laid" + i; })`);
const layOnTheRest = (0, eval)(`(function (all) { for (let i = 2; i < all.length; i += 4) all[i].tint = i; })`);
drive(tintOf, one => Reflect.get(one, "tint"), rowsBelow(16, Object.prototype), [[0.5, lay], [0.8, layOnTheRest]]);
