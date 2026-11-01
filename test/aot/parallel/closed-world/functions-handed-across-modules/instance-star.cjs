function f90() { return 'ok 90'; }
module.exports = new (class { f90 = f90; })();
