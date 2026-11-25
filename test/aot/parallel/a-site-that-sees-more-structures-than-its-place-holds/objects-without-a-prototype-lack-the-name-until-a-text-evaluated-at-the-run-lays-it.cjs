const { tintOf, drive } = require("./lib-rows.cjs");
const many = (0, eval)(`(function (count) { const all = []; for (let i = 0; i < count; i++) { const one = Object.create(null); for (let k = 0; k <= i; k++) one["listener" + k] = k; all.push(one); } return all; })`);
const lay = (0, eval)(`(function (all) { all[3].tint = "heard"; all[7].tint = 0; })`);
const takeAway = (0, eval)(`(function (all) { delete all[3].tint; })`);
drive(tintOf, one => Reflect.get(one, "tint"), many(12), [[0.5, lay], [0.8, takeAway]]);
