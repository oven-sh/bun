// `dx = b.x - a.x` and what is reckoned with it, over records out of a text: fractions, whole numbers, texts, null, booleans, objects with valueOf, big integers on both sides and on one.
const make = at => JSON.parse("[" + Array.from({ length: 8 }, (_, i) => JSON.stringify(at(i))).join() + "]");
function pull(bodies) {
  let sum = 0;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      sum = sum + d2 + dx * b.m - dy * a.m;
    }
  }
  return sum;
}
const sets = [make(i => ({ x: i + 0.5, y: i * 2.25, m: i + 1 })), make(i => ({ x: i, y: i * 2, m: 1 })), make(i => ({ x: i % 3 ? i : String(i), y: i, m: 2 })), make(i => ({ x: i % 3 ? i : null, y: i % 2 === 0, m: 2 })), make(i => ({ x: i, m: 2 }))];
const big = make(i => ({ x: i, y: i, m: 1 })); for (const body of big) { body.x = BigInt(body.x); body.y = BigInt(body.y); body.m = 3n; }
const half = make(i => ({ x: i, y: i, m: 1 })); half[5].x = 5n;
const asked = []; const odd = make(i => ({ x: i, y: i, m: 1 })); odd[2].x = { valueOf() { asked.push("x"); return 2.5; } }; odd[4].m = { valueOf() { asked.push("m"); return 3; } };
for (let round = 0; round < 3; round++) {
  for (const bodies of [...sets, big, half, odd]) {
    let said;
    try { said = pull(bodies); } catch (error) { said = error.constructor.name; }
    console.log(round, typeof said, String(said), asked.length);
  }
}
