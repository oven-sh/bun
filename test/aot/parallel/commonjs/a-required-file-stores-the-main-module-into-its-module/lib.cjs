console.log(require.main === module);
const real = module;
module = require.main;
console.log(require.main === module, real === module);
