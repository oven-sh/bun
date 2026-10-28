// Exports are updated and added behind the body.
const m = require("./m.cjs");
const { n } = m;
console.log(m.n, n); m.bump(); console.log(m.n, n, m.late); m.addLate(); console.log(m.late, Object.keys(m).join());
setTimeout(() => console.log(m.n, m.timer), 2);
