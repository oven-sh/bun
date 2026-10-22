// The environment of the process, one probe of many. It prints what plain Bun prints.
const bodies = JSON.parse('[{"x":1.5,"y":2.5,"z":3.5,"vx":0.1,"vy":0.2,"vz":0.3,"mass":10.5},{"x":4.5,"y":5.5,"z":6.5,"vx":0.4,"vy":0.5,"vz":0.6,"mass":20.5},{"x":7.5,"y":8.5,"z":9.5,"vx":0.7,"vy":0.8,"vz":0.9,"mass":30.5}]');
function advance(dt) {
  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const bj = bodies[j];
      const dx = bi.x - bj.x, dy = bi.y - bj.y, dz = bi.z - bj.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const mag = dt / (d2 * Math.sqrt(d2));
      bi.vx -= dx * bj.mass * mag; bi.vy -= dy * bj.mass * mag; bi.vz -= dz * bj.mass * mag;
      bj.vx += dx * bi.mass * mag; bj.vy += dy * bi.mass * mag; bj.vz += dz * bi.mass * mag;
    }
  }
  for (const b of bodies) { b.x += dt * b.vx; b.y += dt * b.vy; b.z += dt * b.vz; }
}
const rounds = Number(process.argv[2] ?? 100000);
for (let i = 0; i < rounds; i++) advance(0.01);
console.log(bodies[0].x.toFixed(6), bodies[2].vz.toFixed(6));
