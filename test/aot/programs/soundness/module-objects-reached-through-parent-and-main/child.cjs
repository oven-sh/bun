const log = [];
const parent = module.parent; parent.exports.byParent = "s"; log.push(parent.exports.f(1));
const main = require.main; main.exports.byMain = "s"; log.push(main.exports.f("s"));
const fromProcess = process.mainModule; fromProcess.exports.byProcess = "s"; log.push(fromProcess.exports.f());
module.exports = log;
