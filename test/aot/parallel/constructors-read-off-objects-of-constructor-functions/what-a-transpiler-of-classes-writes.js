const turns = +process.argv[2] || 200;
var link = function (d, b) { Object.setPrototypeOf(d, b); function Between() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (Between.prototype = b.prototype, new Between()); };
var Above = (function () { function Above(name) { this.name = name; this.legs = 4; } Above.prototype.score = function () { return this.name.length + this.legs; }; Above.prototype.again = function () { return new this.constructor(this.name + "x"); }; return Above; }());
var Child = (function (parent) { link(Child, parent); function Child(name) { var self = parent.call(this, name) || this; self.child = true; return self; } return Child; }(Above));
var Bare = (function (parent) { link(Bare, parent); function Bare() { return parent !== null && parent.apply(this, arguments) || this; } return Bare; }(Child));
function ask(o, maker) { return o.constructor === maker; }
let right = 0, length = 0;
for (let i = 0; i < turns; i++) { const a = new Above("a"), c = new Child("c"), b = new Bare("b"); if (ask(a, Above) && ask(c, Child) && ask(b, Bare) && !ask(b, Child)) right++; const next = (i % 3 === 0 ? a : i % 3 === 1 ? c : b).again(); length += next.score() + (next.child ? 100 : 0) + (next instanceof Bare ? 1000 : 0); }
console.log(right, length);
