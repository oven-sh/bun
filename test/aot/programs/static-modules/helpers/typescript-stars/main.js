// What TypeScript emits for `export * from "./x"; export * from "./y"; export const own = 1`: a local name beats a star, the first of two stars wins, `default` is left out.
const i = require("./index");
console.log(Object.keys(i).join(), i.own, i.other, i.shared, i.onlyY, i.default);
