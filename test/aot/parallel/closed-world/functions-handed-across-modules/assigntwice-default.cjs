function f21() { return 'ok 21'; }
const middle = Object.assign({}, { f21 }); Object.assign(module.exports, middle);
