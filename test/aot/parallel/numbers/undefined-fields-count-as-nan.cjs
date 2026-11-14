// STATISTIC: MarkersTakenForNaN >= 12
"use strict";
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}
function step(position, velocity, time) {
  position.x += velocity.x * time;
  position.y -= velocity.y * time;
}
function solve(bodies, count) {
  let angle = 0;
  for (let k = 0; k < count; k++) {
    const body = bodies[k % bodies.length];
    const impulse = body.velocity.x * body.position.y - angle;
    body.velocity.x -= impulse * 0.25;
    angle += body.velocity.y * 0.5 - body.position.x;
  }
  return angle;
}
function kinds(a, b) {
  const sum = a.x + b.x;
  const held = [sum, a.y * b.y, -a.x];
  const bits = new Float64Array([a.x - b.y]);
  return [typeof sum, held.map(String).join(), String(bits[0]), sum === sum, Object.is(a.x * 1, NaN), (a.x - b.x) | 0, sum > 1 ? "above" : "not above"].join(" ");
}
const made = [new Vector(1.5, -2), new Vector(undefined, 0.25), new Vector(3, undefined), new Vector(), new Vector(-0, 1e300), new Vector(0 / 0, Infinity)];
for (const a of made) for (const b of made) console.log(dot(a, b), kinds(a, b));
for (const a of made) {
  for (const b of made) {
    const position = new Vector(a.x, a.y);
    step(position, b, 0.5);
    console.log(position.x, position.y, typeof position.x, typeof position.y);
  }
}
for (const a of made) {
  const bodies = made.map(one => ({ position: new Vector(one.x, one.y), velocity: new Vector(a.x, one.y) }));
  console.log(solve(bodies, 12), bodies.map(body => `${body.velocity.x} ${body.velocity.y}`).join(";"));
}
