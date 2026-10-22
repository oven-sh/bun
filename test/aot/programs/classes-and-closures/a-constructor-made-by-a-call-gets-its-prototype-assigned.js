var Class = { create: function () { return function () { this.initialize.apply(this, arguments); }; } };
var Foo = Class.create();
Foo.prototype = { initialize: function (x) { this.x = x; }, get: function () { return this.x; } };
var Bar = Class.create();
Bar.prototype = { initialize: function (x) { this.y = x + 1; }, get: function () { return this.y; } };
var f = new Foo(5), b = new Bar(5);
console.log(f.get(), b.get(), f instanceof Foo, b instanceof Foo);
