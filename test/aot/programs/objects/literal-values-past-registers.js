// Untyped object literals with more values than the allocation stub takes in registers. A later store under a computed key makes two of them ordinary objects. The values past the registers are cells, and every value is read again after forced collections.
function describe(object) {
  return `${JSON.stringify(object)} [${Object.keys(object).join()}]`;
}

function seven(i) {
  const object = { a: "a" + i, b: [i], c: { at: i }, d: "d" + i, e: [i, i + 1], f: { at: i + 1 }, g: "g" + i };
  object["extra" + (i % 2)] = i;
  return object;
}
function isSeven(object, i) {
  return object.a === "a" + i && object.b[0] === i && object.c.at === i && object.d === "d" + i && object.e[1] === i + 1 && object.f.at === i + 1 && object.g === "g" + i;
}

function nine(i) {
  const object = { a: i, b: i + 0.5, c: "c" + i, d: null, e: undefined, f: [i], g: { at: i }, h: "h" + i, i: [[i]] };
  object["extra" + (i % 2)] = "x" + i;
  return object;
}
function isNine(object, i) {
  return object.a === i && object.b === i + 0.5 && object.c === "c" + i && object.d === null && object.e === undefined && object.f[0] === i && object.g.at === i && object.h === "h" + i && object.i[0][0] === i;
}

function sevenWithFixedKeys(i) {
  return { a: "a" + i, b: [i], c: { at: i }, d: "d" + i, e: [i, i + 1], f: { at: i + 1 }, g: "g" + i };
}

const cases = [
  ["seven", seven, isSeven],
  ["nine", nine, isNine],
  ["seven with fixed keys", sevenWithFixedKeys, isSeven],
];

for (const [label, make, isIntact] of cases) {
  const first = make(1);
  Bun.gc(true);
  console.log(label, describe(first));

  let damaged = 0;
  const survivors = [];
  for (let round = 0; round < 20000; round++) {
    const object = make(round);
    if (!isIntact(object, round)) damaged++;
    if (round % 5000 === 4999) {
      survivors.push([object, round]);
      Bun.gc(true);
    }
  }
  Bun.gc(true);
  console.log(label, "damaged", damaged);
  for (const [survivor, round] of survivors) console.log(label, isIntact(survivor, round), describe(survivor));
}
