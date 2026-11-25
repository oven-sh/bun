interface Point {
  x: number;
  y?: number;
  label?: string;
}

interface Box {
  width: number;
  height: number;
  content?: Point;
}

const collect = () => Bun.gc(true);

// One object a literal: nothing but the object holds the structure of its layout.
const kept = { name: "kept", list: [1, 2, 3], nested: { deep: { deeper: "yes" } } };
let dropped: { left: number; right: string } | undefined = { left: 1, right: "r" };
console.log(dropped.left, dropped.right);
dropped = undefined;
collect();
console.log(JSON.stringify(kept), kept.nested.deep.deeper, Object.keys(kept).join());

// The same literal again, behind a collection that took the first object.
function makePair(n: number) {
  return { first: n, second: n + 1, third: String(n) };
}
for (let turn = 0; turn < 4; turn++) {
  const pair = makePair(turn);
  console.log(turn, JSON.stringify(pair), pair.third.length);
  collect();
}

// Two literals of one layout, the one behind the death of the other's object.
function makePoint(x: number): Point {
  return { x };
}
function makeLabeledPoint(x: number): Point {
  return { x, label: "p" + x };
}
console.log(JSON.stringify(makePoint(1)));
collect();
console.log(JSON.stringify(makeLabeledPoint(2)));
collect();
const late = makePoint(3);
late.y = 4;
late.label = "late";
collect();
console.log(JSON.stringify(late), Object.keys(late).join());

// The layout of a literal that is also parsed, spread, assigned and copied.
const boxes: Box[] = [];
boxes.push({ width: 1, height: 2 });
collect();
boxes.push(JSON.parse('{"width":3,"height":4,"content":{"x":5}}') as Box);
collect();
boxes.push({ ...boxes[0], content: makePoint(6) });
boxes.push(Object.assign({ width: 0, height: 0 }, boxes[1]));
boxes.push(structuredClone(boxes[2]));
boxes.splice(0, 1);
collect();
for (const box of boxes) console.log(JSON.stringify(box), box.content?.x, box.width * box.height);

// Late names, deletions, prototypes and freezing on an object that is alone in its layout.
const alone: Record<string, unknown> = { alpha: 1, beta: 2 };
alone.gamma = 3;
collect();
delete alone.beta;
console.log(JSON.stringify(alone), "beta" in alone);
Object.setPrototypeOf(alone, { inherited: "above" });
collect();
console.log((alone as { inherited?: string }).inherited, Object.keys(alone).join());
const frozen = Object.freeze({ sealed: true, part: { open: 1 } });
collect();
console.log(Object.isFrozen(frozen), frozen.part.open, JSON.stringify(frozen));

// Many layouts, each with an object or none by the time of the collection.
const makers: (() => object)[] = [
  () => ({ a0: 0, b0: 0 }),
  () => ({ a1: 1, b1: "1" }),
  () => ({ a2: 2, c2: [2] }),
  () => ({ a3: 3, d3: { e3: 3 } }),
  () => ({ a4: 4, f4: () => 4 }),
  () => ({ get a5() { return 5; }, b5: 5 }),
  () => ({ a6: null, b6: undefined, c6: 6.5 }),
  () => ({ ["a" + 7]: 7, b7: 7n.toString() }),
];
const survivors: object[] = [];
for (let round = 0; round < 3; round++) {
  makers.forEach((make, index) => {
    const object = make();
    if ((index + round) % 3 === 0) survivors.push(object);
  });
  collect();
}
console.log(survivors.map(object => JSON.stringify(object)).join(" "));

// A generator and an async function that make their one object between two collections.
function* objectsOneByOne() {
  yield { step: "one" };
  collect();
  yield { step: "two", more: true };
}
for (const object of objectsOneByOne()) console.log(JSON.stringify(object));
async function later() {
  const before = { before: 1 };
  await null;
  collect();
  return { before, after: 2 };
}
console.log(JSON.stringify(await later()));
