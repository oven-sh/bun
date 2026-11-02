function f85() { return 'ok 85'; }
module.exports = new (class { f85 = f85; })();
