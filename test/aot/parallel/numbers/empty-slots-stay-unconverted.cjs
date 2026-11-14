// STATISTIC: EmptySlotConversionsSkipped >= 20
"use strict";
class Body {
  constructor(mass) {
    this.mass = mass;
  }
  prepare(radius) {
    this.radius = radius;
    this.scale = radius * 0.5;
  }
  join(other) {
    this.other = other;
  }
}
function area(body) {
  return body.radius * body.radius * 3 + body.scale - body.mass;
}
function reach(body) {
  return body.other.mass + body.other.other.mass;
}
function total(bodies, count) {
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const body = bodies[k % bodies.length];
    sum += body.radius * 2 - body.scale;
    sum -= body.mass * body.radius;
  }
  return sum;
}
const bodies = [];
for (let k = 0; k < 4; k++) bodies.push(new Body(k + 0.5));
console.log(area(bodies[0]), total(bodies, 8), bodies[1].radius, "radius" in bodies[1]);
for (let k = 0; k < 4; k++) if (k !== 2) bodies[k].prepare(k * 1.5);
console.log(area(bodies[0]), area(bodies[2]), total(bodies, 8), total(bodies, 2));
bodies[2].prepare(2.25);
console.log(area(bodies[2]), total(bodies, 8));
function attempt(body) {
  try {
    return reach(body);
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(attempt(bodies[0]));
bodies[0].join(bodies[1]);
console.log(attempt(bodies[0]), attempt(bodies[1]));
bodies[1].join(bodies[3]);
console.log(attempt(bodies[0]), attempt(bodies[1]), attempt(bodies[3]));
bodies[3].join(bodies[0]);
console.log(bodies.map(attempt).join());
bodies[2].prepare(undefined);
console.log(area(bodies[2]), total(bodies, 8), Object.keys(bodies[2]).join());
