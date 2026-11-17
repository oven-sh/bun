import wheel = require("./wheel.cts"); // @ts-expect-error
exports.seen = (): number => wheel.turn;
