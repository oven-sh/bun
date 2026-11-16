console.log(typeof early, early(), typeof later, v);
var v = 1;
function early() { return typeof v + ":" + typeof later; }
var later = function () { return v; };
var v = 2;
console.log(later(), (function () { return v++; })(), v, early());
