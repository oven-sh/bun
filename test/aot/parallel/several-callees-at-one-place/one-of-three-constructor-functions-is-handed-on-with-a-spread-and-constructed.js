function First(n) { this.n = n; }
First.prototype.unused = function () { return 1; };
First.prototype.name = function () { return "first" + this.n; };
function Second(n) { this.n = n + 1; }
Second.prototype.unused = function () { return 2; };
Second.prototype.name = function () { return "second" + this.n; };
function Third(n) { this.n = n + 2; }
Third.prototype.alsoUnused = function () { return 3; };
Third.prototype.name = function () { return "third" + this.n; };
function construct(Chosen, ...rest) { return new Chosen(...rest); }
const out = [];
for (let i = 0; i < 6; i++) { const Chosen = i % 3 === 0 ? First : i % 3 === 1 ? Second : Third; out.push(construct(Chosen, i).name()); }
const held = { first: First, second: Second, third: Third };
for (let i = 0; i < 6; i++) { const Chosen = i % 3 === 0 ? held.first : i % 3 === 1 ? held.second : held.third; out.push(new Chosen(i).name()); }
console.log(out.join());
