// `require.main` held as a value.
const m = require.main;
console.log(m === module, m.exports === exports, m.id);
