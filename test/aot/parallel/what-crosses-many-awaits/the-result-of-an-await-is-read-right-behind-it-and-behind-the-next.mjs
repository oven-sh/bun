// Where the lists of what is alive across the awaits of a body are together longer than the body, what crosses several awaits has a word in the machine frame.
// The result of an await is such a value itself where it is read again behind the next await.
async function twice(value) {
  return value * 2;
}
async function chained(seed, config) {
  const p0 = (await seed) + 0;
  const p1 = (await seed) + 1;
  const p2 = (await seed) + 2;
  const p3 = (await seed) + 3;
  const p4 = (await seed) + 4;
  const p5 = (await seed) + 5;
  const p6 = (await seed) + 6;
  const p7 = (await seed) + 7;
  const p8 = (await seed) + 8;
  const p9 = (await seed) + 9;
  const p10 = (await seed) + 10;
  const p11 = (await seed) + 11;
  const p12 = (await seed) + 12;
  const p13 = (await seed) + 13;
  const p14 = (await seed) + 14;
  const p15 = (await seed) + 15;
  const p16 = (await seed) + 16;
  const p17 = (await seed) + 17;
  const p18 = (await seed) + 18;
  const p19 = (await seed) + 19;
  const p20 = (await seed) + 20;
  const p21 = (await seed) + 21;
  const p22 = (await seed) + 22;
  const p23 = (await seed) + 23;
  const first = await twice(config.start);
  const second = await twice(first);
  const third = await twice(second + first);
  return [
    first,
    second,
    third,
    config.start,
    p0 +
      p1 +
      p2 +
      p3 +
      p4 +
      p5 +
      p6 +
      p7 +
      p8 +
      p9 +
      p10 +
      p11 +
      p12 +
      p13 +
      p14 +
      p15 +
      p16 +
      p17 +
      p18 +
      p19 +
      p20 +
      p21 +
      p22 +
      p23,
  ].join();
}
async function inOneArm(seed, flag, x, y) {
  const p0 = (await seed) + 0;
  const p1 = (await seed) + 1;
  const p2 = (await seed) + 2;
  const p3 = (await seed) + 3;
  const p4 = (await seed) + 4;
  const p5 = (await seed) + 5;
  const p6 = (await seed) + 6;
  const p7 = (await seed) + 7;
  const p8 = (await seed) + 8;
  const p9 = (await seed) + 9;
  const p10 = (await seed) + 10;
  const p11 = (await seed) + 11;
  const p12 = (await seed) + 12;
  const p13 = (await seed) + 13;
  const p14 = (await seed) + 14;
  const p15 = (await seed) + 15;
  const p16 = (await seed) + 16;
  const p17 = (await seed) + 17;
  const p18 = (await seed) + 18;
  const p19 = (await seed) + 19;
  const p20 = (await seed) + 20;
  const p21 = (await seed) + 21;
  const p22 = (await seed) + 22;
  const p23 = (await seed) + 23;
  const chosen = flag || (await x);
  const next = await y;
  return [
    chosen,
    next,
    flag,
    p0 +
      p1 +
      p2 +
      p3 +
      p4 +
      p5 +
      p6 +
      p7 +
      p8 +
      p9 +
      p10 +
      p11 +
      p12 +
      p13 +
      p14 +
      p15 +
      p16 +
      p17 +
      p18 +
      p19 +
      p20 +
      p21 +
      p22 +
      p23,
  ].join();
}
console.log(await chained(1, { start: 5 }));
console.log(await inOneArm(1, 0, Promise.resolve("x"), "y"), await inOneArm(1, "f", null, "y"));
