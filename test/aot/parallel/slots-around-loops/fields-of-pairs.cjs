// The fields of one object are added to in a loop over others of its class, whose fields are added to as well: any of them may be the same object, so the fields are read where they are written, once in an iteration.
// STATISTIC: SlotsCarriedAroundLoops = 0
function Body(x, y, z, vx, vy, vz, mass) {
  this.x = x;
  this.y = y;
  this.z = z;
  this.vx = vx;
  this.vy = vy;
  this.vz = vz;
  this.mass = mass;
}
function make(i) {
  return new Body(1.3 * i + 0.2, 0.3 - 1.1 * i, 0.1 * i, 219.15 / (i + 1), 1022.7 / (i + 2), -7.305 * i, 39.47 * (i ? 1e-3 / i : 1));
}
function System(bodies) {
  this.bodies = bodies;
}
System.prototype.advance = function (dt) {
  var size = this.bodies.length;
  for (var i = 0; i < size; i++) {
    var a = this.bodies[i];
    for (var j = i + 1; j < size; j++) {
      var b = this.bodies[j];
      var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      var distance = Math.sqrt(dx * dx + dy * dy + dz * dz + 1e-9);
      var magnitude = dt / (distance * distance * distance);
      a.vx -= dx * b.mass * magnitude + 1e-3;
      a.vy -= dy * b.mass * magnitude + 1e-3;
      a.vz -= dz * b.mass * magnitude + 1e-3;
      b.vx += dx * a.mass * magnitude + 2e-3;
      b.vy += dy * a.mass * magnitude + 2e-3;
      b.vz += dz * a.mass * magnitude + 2e-3;
    }
  }
  for (var i = 0; i < size; i++) {
    var body = this.bodies[i];
    body.x += dt * body.vx;
    body.y += dt * body.vy;
    body.z += dt * body.vz;
  }
};
System.prototype.energy = function () {
  var e = 0;
  for (var i = 0; i < this.bodies.length; i++) {
    var a = this.bodies[i];
    e += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz);
  }
  return e;
};
var apart = new System([make(0), make(1), make(2), make(3), make(4)]);
var one = make(1), two = make(2);
var alike = new System([one, two, one, make(3), two, one]);
for (var n = 0; n < 400; n++) {
  apart.advance(0.01);
  alike.advance(0.01);
}
console.log(apart.energy(), alike.energy(), one.vx, two.vy, one.vz);
