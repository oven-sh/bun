const { tintOf, rowsBelow, drive } = require("./lib-rows.cjs");
const some = (0, eval)(`(function (all) { for (let i = 1; i < all.length; i += 4) delete all[i].tint; })`);
const rest = (0, eval)(`(function (all) { for (let i = 3; i < all.length; i += 4) delete all[i].tint; })`);
const again = (0, eval)(`(function (all) { for (let i = 0; i < all.length; i++) all[i].tint = i + 0.5; })`);
drive(tintOf, one => Reflect.get(one, "tint"), rowsBelow(16, Object.prototype), [[0.4, some], [0.6, rest], [0.8, again]]);
