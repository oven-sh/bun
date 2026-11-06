function f86() { return 'ok 86'; }
module.exports = new (class { f86 = f86; })();
