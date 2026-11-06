function f120() { return 'ok 120'; }
module.exports = new Proxy({ f120 }, {});
