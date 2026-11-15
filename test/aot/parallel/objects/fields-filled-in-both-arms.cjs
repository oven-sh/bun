// STATISTIC: FieldInitializationChecksEmitted >= 24
"use strict";
function Body() {
  this.prepare.apply(this, arguments);
}
Body.prototype.prepare = function (kind, size) {
  this.flags = 0;
  if (kind === 1) {
    this.mass = size;
    this.inverse = 1 / size;
  } else if (kind === 2) this.inverse = this.mass = 0.5;
  else {
    this.inverse = 0;
    this.mass = 0;
  }
  switch (kind & 1) {
    case 0:
      this.speed = size * 2;
      break;
    default:
      this.speed = 0.25;
  }
  this.kind = kind;
};
function Late(kind) {
  this.prepare(kind);
}
Late.prototype.prepare = function (kind) {
  if (kind > 1) this.some = kind;
  if (kind === 3) return;
  this.more = kind * 0.5;
};
function energy(bodies, count) {
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const body = bodies[k % bodies.length];
    sum += body.mass * body.speed * body.speed - body.inverse;
    body.speed = body.speed * 0.5 + body.inverse;
  }
  return sum;
}
const bodies = [];
for (let k = 0; k < 6; k++) bodies.push(new Body(k % 3, k + 1.5));
console.log(energy(bodies, 600), bodies.map((body) => Object.keys(body).join("")).join(" "));
const late = [0, 1, 2, 3].map((kind) => new Late(kind));
console.log(late.map((made) => [made.some, made.more, Object.keys(made).join("")].join("/")).join(" "));
