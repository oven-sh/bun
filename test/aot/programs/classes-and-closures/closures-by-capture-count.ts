// Closures that capture 0 to 6 numbers, strings and objects: arrow functions, function expressions, async arrow functions, and arrow functions that stay in the frame. Every evaluation creates a new function with captures of its own, and the captures survive young collections.
declare const edenGC: undefined | (() => void);
declare const createGlobalObject: undefined | (() => any);
const collectYoung: () => void = typeof edenGC === "function" ? edenGC : require("bun:jsc").edenGC;
const otherRealm: any = typeof createGlobalObject === "function" ? createGlobalObject() : require("node:vm").runInNewContext("globalThis");

type Box = { id: number };
type Factory<R> = (a: number, b: string, c: Box, d: number, e: string, f: Box) => R;
type Reader = () => string;

function readRepeatedly(read: Reader, times: number): string {
  const text = read();
  return times > 1 && readRepeatedly(read, times - 1) !== text ? "the reads differ" : text;
}

// Entry n of a table captures the first n of a to f, in the order listed above the table.
const arrowOrder = [0, 1, 2, 3, 4, 5];
const arrows: Factory<Reader>[] = [
  () => () => "",
  a => () => `${a}`,
  (a, b) => () => `${a},${b}`,
  (a, b, c) => () => `${a},${b},${c.id}`,
  (a, b, c, d) => () => `${a},${b},${c.id},${d}`,
  (a, b, c, d, e) => () => `${a},${b},${c.id},${d},${e}`,
  (a, b, c, d, e, f) => () => `${a},${b},${c.id},${d},${e},${f.id}`,
];
const functionOrder = [1, 2, 4, 5, 0, 3];
const functions: Factory<Reader>[] = [
  () => function () { return ""; },
  (a, b) => function () { return `${b}`; },
  (a, b, c) => function () { return `${b},${c.id}`; },
  (a, b, c, d, e) => function () { return `${b},${c.id},${e}`; },
  (a, b, c, d, e, f) => function () { return `${b},${c.id},${e},${f.id}`; },
  (a, b, c, d, e, f) => function () { return `${b},${c.id},${e},${f.id},${a}`; },
  (a, b, c, d, e, f) => function () { return `${b},${c.id},${e},${f.id},${a},${d}`; },
];
const asyncArrowOrder = [2, 3, 4, 5, 0, 1];
const asyncArrows: Factory<() => Promise<string>>[] = [
  () => async () => "",
  (a, b, c) => async () => `${c.id}`,
  (a, b, c, d) => async () => `${c.id},${d}`,
  (a, b, c, d, e) => async () => `${c.id},${d},${e}`,
  (a, b, c, d, e, f) => async () => `${c.id},${d},${e},${f.id}`,
  (a, b, c, d, e, f) => async () => `${c.id},${d},${e},${f.id},${a}`,
  (a, b, c, d, e, f) => async () => `${c.id},${d},${e},${f.id},${a},${b}`,
];
const arrowWithPropertiesOrder = [0, 5, 1, 2, 4, 3];
const arrowsWithProperties: Factory<Reader>[] = [
  () => () => "",
  a => () => `${a}`,
  (a, b, c, d, e, f) => () => `${a},${f.id}`,
  (a, b, c, d, e, f) => () => `${a},${f.id},${b}`,
  (a, b, c, d, e, f) => () => `${a},${f.id},${b},${c.id}`,
  (a, b, c, d, e, f) => () => `${a},${f.id},${b},${c.id},${e}`,
  (a, b, c, d, e, f) => () => `${a},${f.id},${b},${c.id},${e},${d}`,
];
const arrowInFrameOrder = [4, 5, 0, 1, 2, 3];
const arrowsInFrame: Factory<string>[] = [
  () => readRepeatedly(() => "", 3),
  (a, b, c, d, e) => readRepeatedly(() => `${e}`, 3),
  (a, b, c, d, e, f) => readRepeatedly(() => `${e},${f.id}`, 3),
  (a, b, c, d, e, f) => readRepeatedly(() => `${e},${f.id},${a}`, 3),
  (a, b, c, d, e, f) => readRepeatedly(() => `${e},${f.id},${a},${b}`, 3),
  (a, b, c, d, e, f) => readRepeatedly(() => `${e},${f.id},${a},${b},${c.id}`, 3),
  (a, b, c, d, e, f) => readRepeatedly(() => `${e},${f.id},${a},${b},${c.id},${d}`, 3),
];

const rounds = 5000;

function create<R>(table: Factory<R>[], count: number, i: number): R {
  return table[count](i, "s" + i, { id: i * 2 }, i + 0.5, "t" + (i % 7), { id: -i - 1 });
}
// A copy of create(), so that no analysis merges the closures that are used as objects with those that are only called.
function createForObjectUse(table: Factory<Reader>[], count: number, i: number): any {
  return table[count](i, "s" + i, { id: i * 2 }, i + 0.5, "t" + (i % 7), { id: -i - 1 });
}
function expected(order: number[], count: number, i: number): string {
  const all = [String(i), "s" + i, String(i * 2), String(i + 0.5), "t" + (i % 7), String(-i - 1)];
  let text = "";
  for (let k = 0; k < count; k++) text += (k ? "," : "") + all[order[k]];
  return text;
}

function callUntyped(callee: any, argument: number): unknown {
  return callee(argument);
}
function constructUntyped(callee: any): any {
  return new callee();
}
function outcome(work: () => unknown): string {
  try {
    return String(work());
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

// Each closure is called as soon as it exists. Every third one stays alive and is called again after the collections.
function createAndCall<R>(table: Factory<() => R>[], count: number): R[] {
  const results: R[] = [];
  const survivors: (() => R)[] = [];
  for (let i = 0; i < rounds; i++) {
    const read = create(table, count, i);
    results.push(read());
    if (i % 3 === 0) survivors.push(read);
    if (i % 250 === 249) collectYoung();
  }
  for (const read of survivors) results.push(callUntyped(read, 0) as R);
  return results;
}
function readInFrames(count: number): string[] {
  const results: string[] = [];
  for (let i = 0; i < rounds; i++) {
    results.push(create(arrowsInFrame, count, i));
    if (i % 250 === 249) collectYoung();
  }
  return results;
}
function countWrong(texts: string[], order: number[], count: number): number {
  let wrong = 0;
  for (let k = 0; k < texts.length; k++) {
    if (texts[k] !== expected(order, count, k < rounds ? k : (k - rounds) * 3)) wrong++;
  }
  return wrong;
}
function areDistinct<R>(table: Factory<() => R>[], count: number): boolean {
  return create(table, count, 1) !== create(table, count, 1);
}

function useAsObjects(table: Factory<Reader>[], order: number[], count: number): string {
  const first = createForObjectUse(table, count, 1);
  const second = createForObjectUse(table, count, 1);
  first.x = 1;
  let wrong = 0;
  for (let i = 0; i < rounds; i++) {
    const changed = createForObjectUse(table, count, i);
    changed.x = i;
    if (callUntyped(changed, i) !== expected(order, count, i) || changed.x !== i) wrong++;
    if (i % 250 === 249) collectYoung();
  }
  return [
    "same function: " + (first === second),
    "x on the other: " + ("x" in second),
    "typeof: " + typeof first,
    "calls: " + (callUntyped(first, 0) === expected(order, count, 1)) + " " + (callUntyped(second, 0) === expected(order, count, 1)),
    "prototype: " + (first.prototype === undefined ? "none" : first.prototype.constructor === first),
    "new: " + outcome(() => Object.getPrototypeOf(constructUntyped(first)) === first.prototype),
    "wrong: " + wrong,
  ].join(", ");
}

class Point {
  x = 1;
}
function describeList(list: any): string {
  return Array.isArray(list) + " " + list.length + " " + list[0] + " " + (list instanceof Array);
}

async function main(): Promise<void> {
  const lines: string[] = [];
  for (let count = 0; count <= 6; count++) {
    lines.push(count + " captures");
    lines.push("  read: " + [create(arrows, count, 12)(), create(functions, count, 12)(), await create(asyncArrows, count, 12)(), create(arrowsWithProperties, count, 12)(), create(arrowsInFrame, count, 12)].join(" | "));
    lines.push("  wrong: " + [
      countWrong(createAndCall(arrows, count), arrowOrder, count),
      countWrong(createAndCall(functions, count), functionOrder, count),
      countWrong(await Promise.all(createAndCall(asyncArrows, count)), asyncArrowOrder, count),
      countWrong(createAndCall(arrowsWithProperties, count), arrowWithPropertiesOrder, count),
      countWrong(readInFrames(count), arrowInFrameOrder, count),
    ].join(" "));
    lines.push("  distinct: " + [areDistinct(arrows, count), areDistinct(functions, count), areDistinct(asyncArrows, count), areDistinct(arrowsWithProperties, count)].join(" "));
    lines.push("  function expressions as objects: " + useAsObjects(functions, functionOrder, count));
    lines.push("  arrow functions as objects: " + useAsObjects(arrowsWithProperties, arrowWithPropertiesOrder, count));
  }
  lines.push("call of an object: " + outcome(() => callUntyped({}, 7)));
  lines.push("call of a class: " + outcome(() => callUntyped(Point, 7)));
  lines.push("call of a function of another realm: " + outcome(() => describeList(callUntyped(otherRealm.Array.of, 7))));
  lines.push("new of an object: " + outcome(() => constructUntyped({})));
  lines.push("new of a function of another realm: " + outcome(() => describeList(constructUntyped(otherRealm.Array))));
  console.log(lines.join("\n"));
}
main();
