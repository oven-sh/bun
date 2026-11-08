// The first evaluation's method is read and kept, then the text is evaluated again: the kept closure stays what it was.
var init = (step) => { const table = { step };
  class A { m() { return table.step; } k() { return 1; } }
  return A; };
function read(x) { return x.m; }
const First = init(3);
const kept = read(new First());
const Second = init(100);
console.log(kept(), read(new First())(), read(new Second())(), kept === First.prototype.m, kept === Second.prototype.m);
