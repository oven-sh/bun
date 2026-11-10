// Where the lists of what is alive across the awaits of a body are together longer than the body, what crosses several awaits has a word in the machine frame.
// A loop without an await reads such values once, in front of it.
async function plainLoop(seed, list, factor) {
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
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum = (sum + list[i] * factor) | 0;
  return (
    sum +
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
    p23
  );
}
async function nested(seed, rows, add) {
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
  let sum = 0;
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows[i].length; j++) sum += rows[i][j] + add;
  await seed;
  return (
    sum +
    add +
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
    p23
  );
}
async function catches(seed, list, message) {
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
  let text = "";
  for (let i = 0; i < list.length; i++) {
    try {
      if (list[i] % 3 === 0) throw new Error(message + list[i]);
      text += list[i];
    } catch (error) {
      text += "[" + error.message + message.length + "]";
    }
  }
  await seed;
  return (
    text +
    message +
    (p0 +
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
      p23)
  );
}
async function leaves(seed, list, stop, skip) {
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
  let seen = 0;
  for (const each of list) {
    if (each === skip) continue;
    if (each === stop) break;
    seen += each;
  }
  const between = seen;
  await seed;
  return [
    between,
    stop,
    skip,
    list.length,
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
async function innerLoopUnderAnAwaitingOne(seed, rows, scale) {
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
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    await seed;
    for (let j = 0; j < rows[i].length; j++) sum += rows[i][j] * scale;
  }
  return (
    sum +
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
    p23
  );
}
async function madeInTheLoopAndKept(seed, list) {
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
  let last = null;
  for (let i = 0; i < list.length; i++) last = { at: i, value: list[i] };
  await seed;
  await seed;
  return (
    last.at +
    ":" +
    last.value +
    ":" +
    (p0 +
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
      p23)
  );
}
const list = Array.from({ length: 100 }, (_, i) => i + 1);
const rows = [list.slice(0, 5), list.slice(5, 9), [], list.slice(9, 30)];
console.log(await plainLoop(1, list, 3));
console.log(await nested(Promise.resolve(2), rows, 2));
console.log(await catches(1, list.slice(0, 8), "m"));
console.log(await leaves(1, list, 40, 7));
console.log(await innerLoopUnderAnAwaitingOne(1, rows, 2));
console.log(await madeInTheLoopAndKept(1, list));
