export const m = require("./x.cjs");
const other = require("./y.cjs");
export { other as viaClause };
export const read = () => m.n;
