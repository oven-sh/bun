eval("var require = path => 'declared ' + path");
module.exports = eval("require('./counted.cjs')");
