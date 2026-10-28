// Another file assigns properties onto the exports.
const m = require("./m.cjs");
Object.assign(m, { a: "assigned", extra: "extra" });
console.log(m.a, m.extra, m.readA(), Object.keys(m).join(), require("./other.cjs").see());
