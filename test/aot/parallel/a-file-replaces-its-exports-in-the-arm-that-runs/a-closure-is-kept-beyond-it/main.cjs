const make = require("./index.cjs");
let kept = make({ step: 3 }).twice;
let filler = [];
for (let i = 0; i < 20000; i++) filler.push({ i });
filler = null;
console.log(kept(), kept());
