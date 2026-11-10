const make = require("./index.cjs");
const all = [];
for (let i = 1; i <= 3; i++) all.push(make({ step: i }));
for (const one of all) one.twice();
console.log(all.map(one => one.read()).join(" "));
