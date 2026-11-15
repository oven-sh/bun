// Object.assign(this, o) below a class with a setter of that name: the value comes to the setter.
class Above { set x(v) { this.up = v + 0.5; } get y() { return this.kept; } set y(v) { this.kept = v * 2; } }
class Below extends Above { constructor(o) { super(); Object.assign(this, o); } }
var all = []; for (var i = 0; i < 40; i++) all.push(new Below({ x: i, y: i * 0.25, z: i === 7 ? "z" : i }));
function sum(n) { var s = 0; for (var i = 0; i < n; i++) { var o = all[i % 40]; s = s + o.up + o.kept + o.y; } return s; }
var text = ""; for (var i = 0; i < 40; i++) text = (text + all[i].up + " " + all[i].kept + " " + all[i].z + " " + all[i].x + ",").slice(-200);
console.log(sum(40), sum(400), text);
