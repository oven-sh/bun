function f89() { return 'ok 89'; }
module.exports = new (class { f89 = f89; })();
