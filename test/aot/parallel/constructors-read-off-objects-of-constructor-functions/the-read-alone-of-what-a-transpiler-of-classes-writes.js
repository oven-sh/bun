function show(row) { try { console.log(row().join(" ")); } catch (e) { console.log("threw", e && e.name, e && e.message); } }
function sum(make, n) { var t = 0; for (var i = 0; i < n; i++) { var o = make(i); var v = o.get ? o.get() : -5; t += typeof v === "number" ? v : 1000; } return t; }
var link = function (d, b) { Object.setPrototypeOf(d, b); function Between() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (Between.prototype = b.prototype, new Between()); };
var Above = (function () { function Above(name) { this.name = name; this.legs = 4; } Above.prototype.score = function () { return this.name.length + this.legs; }; return Above; }());
var Child = (function (parent) { link(Child, parent); function Child(name, age) { var self = parent.call(this, name) || this; self.age = age; return self; } Child.prototype.get = function () { return this.score() + this.age; }; return Child; }(Above));
var Bare = (function (parent) { link(Bare, parent); function Bare() { return parent !== null && parent.apply(this, arguments) || this; } Bare.prototype.get = function () { return this.score() * 2; }; return Bare; }(Child));
show(function () { return ["linked", new Bare("a", 1).constructor === Bare]; });
