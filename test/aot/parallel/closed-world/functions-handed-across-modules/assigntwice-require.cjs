function f22() { return 'ok 22'; }
const middle = Object.assign({}, { f22 }); Object.assign(module.exports, middle);
