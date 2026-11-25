var lines = [];
function Point(x) { this.x = x; }
function Box() { this.list = new Array(1, 2); }
Box.prototype.fill = function () { this.list[0] = new Point(0.5); return this; };
Box.prototype.sum = function () { for (var i = 0, sum = 0; i < 2; i++) { var x = this.list[i].x; if (x !== undefined) sum += x; } return sum; };
function twice(box) { for (var i = 0, t = 0; i < 3; i++) t = box.sum() + t; return t * 2 + box.sum(); }
lines.push(twice(new Box()), twice(new Box().fill()));
Function("Number.prototype.x = 'text';")();
lines.push(twice(new Box()), twice(new Box().fill()));
(0, eval)("Boolean.prototype.x = Number.prototype.x = 2.5;");
lines.push(twice(new Box()), twice(new Box().fill()), (5).x);
console.log(lines.join("\n"));
