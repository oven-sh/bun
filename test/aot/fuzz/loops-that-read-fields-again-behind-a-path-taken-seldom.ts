// A loop of many turns reads fields, elements, lengths and variables that closures share, several times a turn. One or two paths in the body are
// taken seldom: once, at the first or the last turn, every ninety-seventh turn, where a value is missing or behind a throw. Such a path only computes,
// or it stores to what the loop reads: straight on, under another name for the same object, through a call, an accessor, a removal, a change of
// shape or of length. Behind the path the loop reads again, and every turn adds what it read to a sum.
import type { Random } from "./random";

export function generate(random: Random): string {
  const turns = random.pick([60, 200, 1000, 5000]);
  const seldom = () =>
    random.pick([
      `i === ${random.below(turns)}`,
      `i === 0`,
      `i === ${turns - 1}`,
      `i % 97 === ${random.below(97)}`,
      `i % ${random.pick([31, 64, 255])} === 3`,
      `list[i] === undefined`,
      `item.a > ${random.between(50, 4000)}`,
      `(i & 1023) === 1023`,
      `typeof item.b !== "number"`,
      `sum > ${random.between(1000, 100000)} && !once++`,
      `other === item && i > ${random.below(turns)}`,
    ]);
  const read = () =>
    random.pick([
      `item.a`,
      `item.b`,
      `item.a + item.b`,
      `list[i % list.length]`,
      `list.length`,
      `list[0]`,
      `shared`,
      `item.inner.c`,
      `other.a`,
      `holder.item.a`,
      `(item.c ?? 1)`,
      `text.length`,
      `item.list[1]`,
      `table[key]`,
      `Item.count`,
      `view[i & 7]`,
      `getShared()`,
      `item.sum()`,
    ]);
  const change = () =>
    random.pick([
      `{ const computed = ${read()} * 2 + i; carried = computed; }`,
      `carried = carried + 1;`,
      `carried = ${read()};`,
      `item.a = i;`,
      `item.b = item.a + 1;`,
      `other.a = -i;`,
      `holder.item.a += 3;`,
      `holder.item = other;`,
      `item = other;`,
      `item = { a: i, b: 2, inner: { c: 5 }, list: [1, 2], sum() { return this.a; } };`,
      `item.inner = { c: i };`,
      `item.inner.c++;`,
      `delete item.b;`,
      `delete item.c;`,
      `item.c = i;`,
      `item.b = "text";`,
      `item.b = 0.5;`,
      `list.push(i);`,
      `list.length = 2;`,
      `list[0] = i;`,
      `list[i % 5] = undefined;`,
      `list = [i, 2, 3];`,
      `list.shift();`,
      `list[0] = 1.5;`,
      `item.list[1] = i;`,
      `item.list = [0, i];`,
      `shared = i;`,
      `setShared(i);`,
      `touch(item);`,
      `touch(other);`,
      `unknown(item, list);`,
      `Object.defineProperty(item, "a", { get() { return 11; }, configurable: true });`,
      `Object.defineProperty(item, "a", { value: 12, writable: true, configurable: true, enumerable: true });`,
      `Object.setPrototypeOf(item, { c: 40, sum() { return 9; } });`,
      `Object.freeze(item.inner);`,
      `Object.assign(item, { a: 1, b: i });`,
      `text += "x";`,
      `key = key === "x" ? "y" : "x";`,
      `table[key] = i;`,
      `table = { x: i, y: 2 };`,
      `Item.count++;`,
      `view[i & 7] = i;`,
      `view = new Int32Array(8).fill(i);`,
      `item.sum = function () { return 3; };`,
      `try { throw item; } catch (caught) { caught.a = 77; }`,
      `[item, other] = [other, item];`,
      `continue;`,
      `if (i > ${Math.floor(turns / 2)}) break;`,
    ]);
  const body: string[] = [];
  for (let part = 0, parts = random.between(1, 3); part < parts; part++) {
    for (let n = random.between(1, 3); n > 0; n--) body.push(`sum += ${read()};`);
    const changes = Array.from({ length: random.between(1, 3) }, change).join("\n      ");
    body.push(
      random.pick([
        `if (${seldom()}) {\n      ${changes}\n    }`,
        `if (${seldom()}) {\n      ${changes}\n    }`,
        `if (!(${seldom()})) {\n      sum += ${read()};\n    } else {\n      ${changes}\n    }`,
        `try {\n      if (${seldom()}) throw new Error("seldom");\n      sum += ${read()};\n    } catch {\n      ${changes.replace(/continue;|break;/g, "carried++;")}\n    }`,
        `switch (i % 101) {\n      case ${random.below(101)}: {\n      ${changes.replace(/break;/g, "carried++;")}\n      }\n      default:\n        sum += ${read()};\n    }`,
      ]),
    );
    for (let n = random.between(1, 3); n > 0; n--) body.push(`sum += ${read()};`);
  }
  body.push(`if (typeof sum !== "number" || sum !== sum) sum = String(sum).length;`, `sum = sum % 1000003;`);
  const loop = random.pick([
    `for (let i = 0; i < ${turns}; i++)`,
    `for (let i = 0; i < ${turns}; i++)`,
    `let i = -1;\n  while (++i < ${turns})`,
    `for (const i of counted)`,
  ]);
  return `class Item {
  static count = 0;
  constructor(a, b) { this.a = a; this.b = b; this.inner = { c: a }; this.list = [a, b]; }
  sum() { return this.a + 1; }
}
let shared = 1;
const getShared = () => shared;
const setShared = value => { shared = value; };
const touch = item => { item.a = (item.a | 0) + 5; };
const unknowns = [(item, list) => { item.b = 4; }, (item, list) => { list[0] = 8; }, () => {}];
let picked = 0;
const unknown = (item, list) => unknowns[picked++ % unknowns.length](item, list);
const counted = Array.from({ length: ${turns} }, (_, index) => index);
function run(seed, isSame) {
  let item = new Item(seed, 2);
  let other = isSame ? item : new Item(3, seed);
  const holder = { item };
  let list = [1, 2, 3, seed, 5];
  let table = { x: 1, y: seed };
  let view = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
  let key = "x", text = "abc", sum = 0, carried = 0, once = 0;
  ${loop} {
    ${body.join("\n    ")}
  }
  return [sum, carried, JSON.stringify(item), JSON.stringify(other), list.length, list[0], text.length, shared, Item.count, view[3]].join(" ");
}
for (let call = 0; call < ${random.pick([1, 2, 4])}; call++) {
  for (const isSame of [false, true]) {
    try {
      console.log(run(call + 1, isSame));
    } catch (error) {
      console.log("thrown", error.name, shared, Item.count);
    }
  }
}
`;
}
