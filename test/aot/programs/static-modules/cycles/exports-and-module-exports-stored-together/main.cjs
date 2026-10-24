// `exports = module.exports = createApplication` as the first statement, members stored through `exports` behind it, and a module in between that requires this one back.
const app = require("./app.cjs");
console.log(require("./router.cjs").saw, app().router.describe(), app().version);
