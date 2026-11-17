const { tintOf, rowsBelow, drive } = require("./lib-rows.cjs");
const above = (0, eval)(`({ kept: 1 })`);
const onRows = (0, eval)(`(function (all) { for (let i = 1; i < all.length; i += 4) Object.defineProperty(all[i], "tint", { get() { return this.p0 + 40 + i; }, configurable: true }); })`);
const onThePrototype = (0, eval)(`(function (all) { Object.defineProperty(Object.getPrototypeOf(all[0]), "tint", { get() { return "got" + this.p0; }, configurable: true }); })`);
const back = (0, eval)(`(function (all) { for (let i = 1; i < all.length; i += 4) Object.defineProperty(all[i], "tint", { value: i, writable: true, configurable: true }); })`);
drive(tintOf, one => Reflect.get(one, "tint"), rowsBelow(16, above), [[0.4, onRows], [0.6, onThePrototype], [0.8, back]]);
