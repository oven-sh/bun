// `??=`, `||=` and `&&=` store their right side as it is, or nothing at all.
const m = require("./module.cjs");
console.log(m.nullish() === m, m.or() === m, m.and() === m, typeof m.kept());
console.log(Object.keys(m).join(), "absent" in m, m.absent, m.count);
const star = require("./star.cjs");
console.log(Object.keys(star).join(), "absent" in star);
