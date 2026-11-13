// Bodies, springs and walls stepped in time, collisions found by a grid, energy and events, in two modules
import { Ball, Crate, Spring, World } from "./lib";
for (const [name, count, gravity] of [["balls", 40, -9.8], ["mixed", 30, -3], ["drift", 25,
  0]] as const) {
  const world = new World(60, 40);
  const hits: number[] = [];
  let asleep = 0;
  const stop = world.on(e => {
    if (e.kind === "hit") hits.push(Math.round(e.force));
    else asleep++;
});
  world.forces.push(() => ({ x: 0, y: gravity }), (b, t) => ({ x: Math.sin(t + b.id % 7) * 0.5,
    y: 0 }));
  for (let i = 0; i < count; i++) {
    const b = world.add(name === "mixed" && i % 3 === 0 ? new Crate(5 + (i * 7) % 50,
      5 + (i * 3) % 30, 0.8) : new Ball(4 + (i * 11) % 52, 6 + (i * 5) % 28,
      0.5 + (i % 4) * 0.2));
    b.velocity = {
      x: (i % 5) - 2, y: (i % 3) - 1
  };
    if (name === "drift" && i > 0 &&
      i % 5) world.springs.push(new Spring(world.bodies[world.bodies.length - 2], b, 2.5, 8));
  }
  let energy = 0;
  for (let i = 0; i < 1500; i++) {
    energy = world.step(1 / 60);
    if (i === 900) stop();
    if (i % 500 === 499) console.log(name, i, energy.toFixed(6), world.contacts, world.tested,
      world.bodies.slice(0,
      2).map(b => b.position.x.toFixed(4) + "," + b.position.y.toFixed(4)).join(" "));
  }
  console.log(hits.length, hits.reduce((a, b) => a + b, 0), asleep,
    world.bodies.map(b => b.kind[0]).join("").slice(0, 10));
}
