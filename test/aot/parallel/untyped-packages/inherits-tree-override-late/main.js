// An untyped package and a program of it (override late): util.inherits and Function.prototype.call constructors, three levels, super calls by name, toString and valueOf
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var f = new lib.Folder('f'), l = new lib.Leaf('l', 3), k = new lib.Link('k', l); f.add(l); f.add(k); function ask() { return [f.size(), l.size(), k.size(), f.path(), k.path(), String(l), l + 1].join(' '); }
say(ask()); for (var i = 0; i < 10; i++) { if (i === 3) lib.Leaf.prototype.size = function () { return this.bytes * 2; }; if (i === 5) l.size = function () { return 'own'; }; if (i === 6) delete l.size; if (i === 7) lib.Base.prototype.path = function () { return '<' + this.name + '>'; }; if (i === 8) { l.bytes = 1.5; l.name = 'renamed'; } say(i, ask()); }
