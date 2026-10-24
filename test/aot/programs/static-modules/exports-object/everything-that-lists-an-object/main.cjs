// JSON.stringify, a spread, `for in` and Object.getOwnPropertyNames on the exports object.
const a = require("./a.cjs"),
  names = [];
for (const k in a) names.push(k);
console.log(JSON.stringify(a), Object.keys({ ...a }).join(), names.join(), Object.getOwnPropertyNames(a).join());
