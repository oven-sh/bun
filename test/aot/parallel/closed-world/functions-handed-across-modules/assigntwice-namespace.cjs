function f20() { return 'ok 20'; }
const middle = Object.assign({}, { f20 }); Object.assign(module.exports, middle);
