// A direct eval stores into the names of the file: the helper, a class, a namespace.
var link = function (d, b) { function __() { this.constructor = d; } __.prototype = b.prototype; d.prototype = new __(); };
var run = function (source) { return eval(source); };
function Base(n) { this.n = n; }
Base.prototype.get = function () { return 'base' + this.n; };
Base.prototype.step = function () { this.n++; return this.n; };
function Other(n) { this.n = -n; }
Other.prototype.get = function () { return 'other' + this.n; };
Other.prototype.step = function () { this.n--; return this.n; };
var Child = (function (_super) { link(Child, _super); function Child(n) { _super.call(this, n); this.d = 1; } return Child; })(Base);
function loop(n) { var t = []; for (var i = 0; i < n; i++) { var o = new Child(i); t.push(o.get(), o.step(), o instanceof Base, o.d); } return t.join(); }
console.log(loop(3));
run('Child.prototype = Other.prototype');
console.log(loop(2));
run('Child = Other');
console.log(loop(2));
run('Child = Base');
run('Base.prototype.get = function () { return "evaled"; }');
console.log(loop(2));
run('link = function (d, b) { d.prototype = Object.create(Other.prototype); }');
var Late = (function (_super) { link(Late, _super); function Late(n) { _super.call(this, n); } return Late; })(Base);
console.log(new Late(4).get(), new Late(4).step(), new Late(1) instanceof Base);
