// at, indexOf, includes, pop, shift, slice, concat and splice answer alike on lists of integers, of fractions, of objects and of texts: empty lists, holes, literals that are emptied, and lists that take another kind of element between two calls.
type Point = { x: number };
const out: string[] = [];
const show = (...values: unknown[]) =>
  out.push(
    values
      .map(value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)))
      .join(" "),
  );

function ends<T>(list: T[]): unknown[] {
  return [
    list.at(0),
    list.at(-1),
    list.at(1),
    list.at(-2),
    list.at(list.length),
    list.at(-list.length - 1),
    list.at(1.9),
    list.at(-0.5),
    list.at(NaN),
  ];
}
function integers(): number[] {
  const list: number[] = [];
  for (let k = 0; k < 5; k++) list.push(k * 3);
  return list;
}
function fractions(): number[] {
  const list: number[] = [];
  for (let k = 0; k < 5; k++) list.push(k + 0.5);
  return list;
}
function points(): Point[] {
  const list: Point[] = [];
  for (let k = 0; k < 4; k++) list.push({ x: k });
  return list;
}
function texts(): string[] {
  const list: string[] = [];
  for (let k = 0; k < 4; k++) list.push("t" + k);
  return list;
}

for (let round = 0; round < 3; round++) {
  show(
    "ends",
    ...ends(integers()),
    "|",
    ...ends(fractions()),
    "|",
    ...ends(points()),
    "|",
    ...ends(texts()),
    "|",
    ...ends<number>([]),
  );

  const whole = integers(),
    parts = fractions(),
    objects = points(),
    words = texts();
  show(
    "indexOf",
    whole.indexOf(6),
    whole.indexOf(7),
    whole.indexOf(6.5),
    whole.indexOf(-0),
    whole.indexOf(NaN),
    whole.indexOf(2 ** 31),
    whole.indexOf(-(2 ** 31) - 1),
  );
  show(
    "indexOf",
    parts.indexOf(2.5),
    parts.indexOf(2),
    parts.indexOf(NaN),
    parts.indexOf(Infinity),
    [0.5, -0].indexOf(0),
    [0.5, 0].indexOf(-0),
    [0.5, NaN].indexOf(NaN),
  );
  show(
    "indexOf",
    objects.indexOf(objects[2]!),
    objects.indexOf({ x: 2 }),
    words.indexOf("t3"),
    words.indexOf("t" + (round + 1)),
    words.indexOf("t9"),
  );
  show(
    "includes",
    whole.includes(12),
    whole.includes(13),
    whole.includes(NaN),
    parts.includes(4.5),
    parts.includes(4),
    [0.5, NaN].includes(NaN),
    [1, NaN].includes(NaN),
    objects.includes(objects[0]!),
    words.includes("t0"),
  );

  const long: number[] = [];
  for (let k = 0; k < 40; k++) long.push(k);
  const longParts: number[] = [];
  for (let k = 0; k < 40; k++) longParts.push(k / 4);
  show(
    "long",
    long.indexOf(39),
    long.indexOf(40),
    long.includes(17),
    longParts.indexOf(9.75),
    longParts.indexOf(10),
    longParts.includes(0.25),
    long.at(-1),
    longParts.at(-40),
    longParts.at(-41),
  );

  const holes = [1, , 3] as number[],
    holesOfParts = [0.5, , 2.5] as number[],
    holesOfObjects = [{ x: 1 }, , { x: 3 }] as Point[];
  show(
    "holes",
    ...ends(holes),
    holes.indexOf(undefined as never),
    holes.includes(undefined as never),
    holesOfParts.at(1),
    holesOfParts.includes(undefined as never),
    holesOfParts.indexOf(NaN),
    holesOfObjects.at(1),
    holesOfObjects.includes(undefined as never),
  );
  show(
    "holes",
    holes.pop(),
    holes.pop(),
    holes.pop(),
    holes.pop(),
    holes.length,
    holesOfParts.shift(),
    holesOfParts.shift(),
    holesOfParts.shift(),
    holesOfParts.shift(),
    holesOfParts.length,
  );

  let sum = 0;
  while (whole.length > 0) sum += whole.pop()!;
  let sumOfParts = 0;
  while (parts.length) sumOfParts += parts.shift()!;
  let names = "";
  while (words.length) names += words.pop();
  let xs = 0;
  for (let point = objects.shift(); point; point = objects.shift()) xs += point.x;
  show(
    "emptied",
    sum,
    sumOfParts,
    names,
    xs,
    whole.pop(),
    parts.pop(),
    words.shift(),
    objects.pop(),
    whole.at(0),
    parts.at(-1),
    whole.indexOf(0),
    parts.includes(0.5),
  );

  const literal = () => [10, 20, 30];
  const first = literal();
  show("literal", first.pop(), first.shift(), first.length, first.at(-1));
  show("literal", ...literal(), literal().pop(), literal().shift(), literal().at(-1), literal().indexOf(30));
  const literalOfParts = () => [1.5, 2.5];
  const second = literalOfParts();
  second.pop();
  show("literal", ...second, ...literalOfParts(), literalOfParts().includes(2.5));

  const changing: (number | string | undefined)[] = [1, 2, 3];
  show("changing", changing.at(-1), changing.indexOf(2), changing.includes(3));
  changing.push(4.5);
  show("changing", changing.at(-1), changing.indexOf(2), changing.indexOf(4.5), changing.includes(3));
  changing.push("five");
  show(
    "changing",
    changing.at(-1),
    changing.indexOf(2),
    changing.indexOf(4.5),
    changing.indexOf("five"),
    changing.includes(undefined),
  );
  changing.push(undefined);
  show(
    "changing",
    changing.at(-1),
    changing.indexOf(undefined),
    changing.includes(undefined),
    changing.pop(),
    changing.pop(),
    changing.pop(),
    changing.pop(),
    changing.shift(),
    changing.length,
  );

  const numbers: number[] = [1, 2, 3];
  numbers[1] = 2.5;
  show(
    "widened",
    numbers.at(1),
    numbers.indexOf(2.5),
    numbers.indexOf(3),
    numbers.includes(1),
    numbers.pop(),
    numbers.shift(),
    numbers.at(0),
  );
  const cut = integers();
  cut.length = 2;
  show("cut", cut.at(-1), cut.at(2), cut.indexOf(6), cut.pop(), cut.pop(), cut.pop());
  cut.length = 3;
  show(
    "grown",
    cut.at(0),
    cut.at(-1),
    cut.includes(undefined as never),
    cut.indexOf(undefined as never),
    cut.pop(),
    cut.length,
  );
  show(
    "concat",
    integers().concat(integers()),
    integers().concat(fractions()),
    fractions().concat(1, 2.5),
    integers().concat(7),
    integers().concat(7.5),
    points().concat({ x: 9 }).length,
    texts().concat("z", texts()),
    integers().concat([]),
    ([] as number[]).concat(integers()),
    holesOfObjects.concat(points()).length,
  );
  const spliced = integers();
  show(
    "splice",
    spliced.splice(1, 2),
    spliced,
    spliced.splice(1, 0, 100),
    spliced,
    spliced.splice(-1, 1, 7, 8),
    spliced,
    spliced.splice(1, 1, 0.5),
    spliced,
  );
  const splicedParts = fractions();
  show(
    "splice",
    splicedParts.splice(0, 1),
    splicedParts,
    splicedParts.splice(2, 1, 9.5),
    splicedParts,
    splicedParts.splice(9, 1),
    splicedParts.splice(0),
    splicedParts,
  );
  const splicedLiteral = literal();
  show(
    "splice",
    splicedLiteral.splice(0, 1),
    splicedLiteral,
    literal(),
    points().splice(1, 2),
    texts().splice(-2, 1, "u", "v"),
  );
  show(
    "slice",
    integers().slice(1, 3),
    fractions().slice(-2),
    points().slice(3),
    texts().slice(0, -3),
    integers().slice(),
    integers().slice(9),
    fractions().slice(2, 1),
    holesOfObjects.slice(1).length,
  );
}
console.log(out.join("\n"));
