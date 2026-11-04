const a = require("./lib-cycle-a.cjs");
const tries = [];
for (const f of [a.early, a.viaFunction]) { try { tries.push(f()); } catch (e) { tries.push(e.name); } }
exports.tries = tries;
exports.again = () => [a.early(), a.viaFunction()];
