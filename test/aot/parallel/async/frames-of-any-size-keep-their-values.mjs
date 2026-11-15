// Suspended frames with few values, with more than 64 words, with numbers between the values, and frames that wait for long.
const pause = () => new Promise(resolve => setImmediate(resolve));
let kept = [];
function garbage(count) {
  kept = [];
  for (let index = 0; index < count; index++) kept.push({ index, text: "g" + index });
}

async function few(seed) {
  const object = { seed }, text = "t" + seed, list = [seed, seed + 1];
  await pause();
  garbage(2000);
  await null;
  return object.seed + text.length + list[1];
}

async function mixed(seed) {
  const a = { v: seed }, b = seed * 1.5, c = [seed], d = seed | 0, e = "x".repeat(seed % 7), f = seed % 2 === 0, g = BigInt(seed) ** 3n, h = Symbol.for("s" + (seed % 3)), i = seed % 5 ? undefined : null;
  for (let round = 0; round < 3; round++) {
    await pause();
    garbage(500);
    a.v += b + c.length + d + e.length + (f ? 1 : 0) + Number(g % 1000n) + h.description.length + (i === null ? 5 : 1);
    c.push(round);
  }
  return a.v + c.join();
}

const names = Array.from({ length: 90 }, (_, index) => "v" + index);
async function many(seed) {
  const v0 = { n: seed }, v1 = { n: seed + 1 }, v2 = [seed], v3 = "a" + seed, v4 = { n: v0 }, v5 = [v1], v6 = { n: 6 }, v7 = { n: 7 }, v8 = { n: 8 }, v9 = { n: 9 };
  const w0 = { n: 10 }, w1 = { n: 11 }, w2 = { n: 12 }, w3 = { n: 13 }, w4 = { n: 14 }, w5 = { n: 15 }, w6 = { n: 16 }, w7 = { n: 17 }, w8 = { n: 18 }, w9 = { n: 19 };
  const x0 = [20], x1 = [21], x2 = [22], x3 = [23], x4 = [24], x5 = [25], x6 = [26], x7 = [27], x8 = [28], x9 = [29];
  const y0 = seed + 0.5, y1 = seed + 1.5, y2 = seed * 2, y3 = seed / 3, y4 = -seed, y5 = seed ** 2, y6 = seed % 4, y7 = ~seed, y8 = seed << 1, y9 = seed - 0.25;
  const z0 = "b" + seed, z1 = "c" + seed, z2 = "d" + seed, z3 = "e" + seed, z4 = "f" + seed, z5 = "g" + seed, z6 = "h" + seed, z7 = "i" + seed, z8 = "j" + seed, z9 = "k" + seed;
  const p0 = { o: z0 }, p1 = { o: z1 }, p2 = { o: z2 }, p3 = { o: z3 }, p4 = { o: z4 }, p5 = { o: z5 }, p6 = { o: z6 }, p7 = { o: z7 }, p8 = { o: z8 }, p9 = { o: z9 };
  const q0 = { o: p0 }, q1 = { o: p1 }, q2 = { o: p2 }, q3 = { o: p3 }, q4 = { o: p4 }, q5 = { o: p5 }, q6 = { o: p6 }, q7 = { o: p7 }, q8 = { o: p8 }, q9 = { o: p9 };
  await pause();
  garbage(3000);
  await pause();
  const numbers = y0 + y1 + y2 + y3 + y4 + y5 + y6 + y7 + y8 + y9 + v0.n + v1.n + v2[0] + v4.n.n + v5[0].n + v6.n + v7.n + v8.n + v9.n + w0.n + w1.n + w2.n + w3.n + w4.n + w5.n + w6.n + w7.n + w8.n + w9.n + x0[0] + x1[0] + x2[0] + x3[0] + x4[0] + x5[0] + x6[0] + x7[0] + x8[0] + x9[0];
  return [numbers, v3, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9, q0.o.o, q1.o.o, q2.o.o, q3.o.o, q4.o.o, q5.o.o, q6.o.o, q7.o.o, q8.o.o, q9.o.o, p5.o].join();
}

class Holder {
  constructor(value) {
    this.value = value;
  }
  async wait(other) {
    const before = this.value;
    await pause();
    garbage(1000);
    const sum = before.n + other.value.n;
    await other.settle();
    return sum + this.value.n;
  }
  async settle() {
    await pause();
    this.value = { n: this.value.n + 1 };
  }
}

const results = [];
for (let round = 0; round < 3; round++) {
  const promises = [];
  for (let seed = 1; seed <= 60; seed++) {
    promises.push(few(seed), mixed(seed), new Holder({ n: seed }).wait(new Holder({ n: seed * 2 })));
    if (seed % 6 === 0) promises.push(many(seed));
  }
  garbage(20000);
  results.push((await Promise.all(promises)).join("|"));
}
console.log(results[0]);
console.log(results.every(result => result === results[0]), kept.length, names.length);
