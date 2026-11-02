function f23() { return 'ok 23'; }
const middle = Object.assign({}, { f23 }); Object.assign(module.exports, middle);
