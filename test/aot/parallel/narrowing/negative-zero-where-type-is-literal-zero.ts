// TypeScript gives `-0` the literal type `0`. Wherever that type is written, a `-0` stays a `-0`.
type Leaf = { op: 0; value: number };
type Pair = { op: 1; left: number; right: number };
type Tree = Leaf | Pair;

function signOfZero(value: number): string {
  return Object.is(value, -0) ? "-0" : Object.is(value, 0) ? "+0" : String(value);
}

function total(tree: Tree): number {
  if (tree.op === 0) return tree.value;
  return tree.left + tree.right;
}

function tagOf(tree: Tree): string {
  return signOfZero(tree.op);
}

function takesZeroOrOne(flag: 0 | 1): string {
  if (flag === 0) return "zero " + signOfZero(flag) + " " + 1 / flag;
  return "one " + signOfZero(flag);
}

function returnsZero(negative: boolean): 0 {
  return negative ? -0 : 0;
}

class Counter {
  start: 0 = 0;
  step: 0 | 1 | 2 = 1;
}

const leaves: Leaf[] = [
  { op: 0, value: 1.5 },
  { op: -0, value: 2.5 },
];
const trees: Tree[] = [...leaves, { op: 1, left: 1, right: 2 }];
for (let round = 0; round < 3; round++) {
  for (const tree of trees) console.log(tagOf(tree), total(tree));
  console.log(takesZeroOrOne(0), "|", takesZeroOrOne(-0), "|", takesZeroOrOne(1));
  console.log(signOfZero(returnsZero(false)), signOfZero(returnsZero(true)), 1 / returnsZero(true));
}

const counter = new Counter();
console.log(signOfZero(counter.start), counter.step);
counter.start = -0;
counter.step = 0;
console.log(signOfZero(counter.start), signOfZero(counter.step), 1 / counter.start);
counter.step = -0;
console.log(signOfZero(counter.step), JSON.stringify(counter), Object.is(counter.step, counter.start));

const zero = -0;
const list: 0[] = [0, -0, zero];
console.log(list.map(signOfZero).join(" "), list.includes(0), list.indexOf(-0), Math.min(...list), signOfZero(Math.max(...list)));
const table: Record<"a" | "b", 0 | 1> = { a: -0, b: 1 };
console.log(signOfZero(table.a), table.b, signOfZero(table.a + table.a), signOfZero(table.a * table.b));
switch (table.a) {
  case 0:
    console.log("case 0", signOfZero(table.a));
    break;
  case 1:
    console.log("case 1");
    break;
}
