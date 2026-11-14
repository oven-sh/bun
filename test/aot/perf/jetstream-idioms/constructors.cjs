// Objects that are made and read, by the way in which their constructor passes its arguments on.
class Class { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
function Assigned(x, y) { this.x = x; this.y = y; }
Assigned.prototype.sum = function () { return this.x + this.y; };
function Initialized(x, y) { this.init(x, y); }
Initialized.prototype.init = function (x, y) { this.x = x; this.y = y; };
Initialized.prototype.sum = function () { return this.x + this.y; };
function Called(x, y) { this.init.call(this, x, y); }
Called.prototype.init = function (x, y) { this.x = x; this.y = y; };
Called.prototype.sum = function () { return this.x + this.y; };
function Listed(x, y) { this.init.apply(this, [x, y]); }
Listed.prototype.init = function (x, y) { this.x = x; this.y = y; };
Listed.prototype.sum = function () { return this.x + this.y; };
function Strict() { "use strict"; this.init.apply(this, arguments); }
Strict.prototype.init = function (x, y) { this.x = x; this.y = y; };
Strict.prototype.sum = function () { return this.x + this.y; };
function Applied() { this.init.apply(this, arguments); }
Applied.prototype.init = function (x, y) { this.x = x; this.y = y; };
Applied.prototype.sum = function () { return this.x + this.y; };
function RestApplied(...rest) { this.init.apply(this, rest); }
RestApplied.prototype.init = function (x, y) { this.x = x; this.y = y; };
RestApplied.prototype.sum = function () { return this.x + this.y; };
function RestSpread(...rest) { this.init(...rest); }
RestSpread.prototype.init = function (x, y) { this.x = x; this.y = y; };
RestSpread.prototype.sum = function () { return this.x + this.y; };
function Static() { Static.make.apply(this, arguments); }
Static.make = function (x, y) { this.x = x; this.y = y; };
Static.prototype.sum = function () { return this.x + this.y; };
var Factory = { create: function () { return function () { this.init.apply(this, arguments); }; } };
var Factored = Factory.create();
Factored.prototype = { x: 0, y: 0, init: function (x, y) { this.x = x; this.y = y; }, sum: function () { return this.x + this.y; } };
const loops = {
  "a class": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new Class(i, 1); s = (s + p.sum()) | 0; } return s; },
  "methods assigned to the prototype": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new Assigned(i, 1); s = (s + p.sum()) | 0; } return s; },
  "this.init(x, y)": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new Initialized(i, 1); s = (s + p.sum()) | 0; } return s; },
  "this.init.call(this, x, y)": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new Called(i, 1); s = (s + p.sum()) | 0; } return s; },
  "this.init.apply(this, [x, y])": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new Listed(i, 1); s = (s + p.sum()) | 0; } return s; },
  "this.init.apply(this, arguments), strict": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new Strict(i, 1); s = (s + p.sum()) | 0; } return s; },
  "this.init.apply(this, arguments)": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new Applied(i, 1); s = (s + p.sum()) | 0; } return s; },
  "this.init.apply(this, rest)": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new RestApplied(i, 1); s = (s + p.sum()) | 0; } return s; },
  "this.init(...rest)": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new RestSpread(i, 1); s = (s + p.sum()) | 0; } return s; },
  "Static.make.apply(this, arguments)": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new Static(i, 1); s = (s + p.sum()) | 0; } return s; },
  "Class.create()": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var p = new Factored(i, 1); s = (s + p.sum()) | 0; } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
