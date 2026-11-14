// A constructor of the file, beside one that is a property of a namespace object.
function Vector(x, y) { this.x = x; this.y = y; }
Vector.prototype.dot = function (o) { return this.x * o.x + this.y * o.y; };
function Body(i) { this.v = new Vector(i * 0.5, 1.5); this.w = new Vector(0.25, i * 0.125); this.m = 0.5; }
var bodies = []; for (var i = 0; i < 16; i++) bodies.push(new Body(i));
var Space = {};
(function () { function Vector(x, y) { this.Vector(x, y); } Space.Vector = Vector; })();
(function () { var Vector = Space.Vector; Vector.prototype.Vector = function (x, y) { this.x = x; this.y = y; }; Vector.prototype.dot = function (o) { return this.x * o.x + this.y * o.y; }; })();
function SpaceBody(i) { this.v = new Space.Vector(i * 0.5, 1.5); this.w = new Space.Vector(0.25, i * 0.125); this.m = 0.5; }
var spaceBodies = []; for (var i = 0; i < 16; i++) spaceBodies.push(new SpaceBody(i));
const loops = {
  "a constructor of the file": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var b = bodies[i & 15]; s += b.v.dot(b.w); } return s; },
  "a constructor in a namespace, its fields in a method": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var b = spaceBodies[i & 15]; s += b.v.dot(b.w); } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
