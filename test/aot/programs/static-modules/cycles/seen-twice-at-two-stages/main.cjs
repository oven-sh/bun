// One body requires two modules, one after the other, and each requires it back: the second sees more names than the first.
const a = require("./a.cjs");
console.log(a.saw, require("./b.cjs").now());
