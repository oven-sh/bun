import {
  Box,
  Point,
  callWithNothing,
  counts,
  emptyFields,
  emptyPair,
  flagOrNull,
  integerOrNull,
  integersWithGaps,
  later,
  numberOrNothing,
  numbersWithGaps,
  pick,
  pointOrNothing,
  pushNothing,
  settings,
  textOrNothing,
  textsWithGaps,
  total,
} from "./inner/lib.ts";

function show(label: string, value: unknown) {
  console.log(label, typeof value, String(value));
}
function addOne(n: number): number {
  return n + 1;
}
function twice(n: number): number {
  return n * 2;
}
function bits(n: number): number {
  return (n | 0) + (n >>> 1);
}
function size(s: string): number {
  try {
    return s.length;
  } catch {
    return -1;
  }
}
function sumOf(p: Point): number {
  try {
    return p.sum();
  } catch {
    return -1;
  }
}
function sum(list: number[]): number {
  let result = 0;
  for (const n of list) result += n;
  return result;
}
function sumByIndex(list: number[]): number {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i] as number;
  return result;
}

for (const flag of [true, false]) {
  const n = numberOrNothing(flag);
  show("number", n);
  show("number + 1", addOne(n));
  show("number * 2", twice(n));
  show("number bits", bits(n));
  show("number is undefined", n === undefined);
  show("number or 5", n ?? 5);
  show("number text", `${n}`);
  const i = integerOrNull(flag);
  show("integer", i);
  show("integer + 1", addOne(i));
  show("integer bits", bits(i));
  show("integer is null", i === null);
  show("integer < 1", i < 1);
  const s = textOrNothing(flag);
  show("text", s);
  show("text size", size(s));
  show("text + !", s + "!");
  const b = flagOrNull(flag);
  show("flag", b);
  show("flag not", !b);
  show("flag is false", b === false);
  const p = pointOrNothing(flag);
  show("point", p === undefined ? "nothing" : p.sum());
  show("point sum", sumOf(p));
}
show(
  "callback",
  callWithNothing((n, s, p, b) => `${n + 1} ${s + "!"} ${typeof p} ${b === false} ${n === undefined} ${s === null}`),
);
const point = new Point(3, 4);
show("fields before", point.sum());
emptyFields(point);
show("field x", point.x);
show("field y", point.y);
show("field label", point.label);
show("field next", point.next);
show("fields sum", point.sum());
show("field x + 1", addOne(point.x));
show("field y + 1", addOne(point.y));
const pair = { left: 1, right: "r" };
emptyPair(pair);
show("pair left", pair.left);
show("pair left + 1", pair.left + 1);
show("pair right", pair.right);
const gaps = numbersWithGaps();
show("elements", gaps.join());
show("elements sum", sum(gaps));
show("elements by index", sumByIndex(gaps));
show("element 1", gaps[1]);
show("element 3", gaps[3]);
show("elements mapped", gaps.map(n => n + 1).join());
show("integers sum", sum(integersWithGaps()));
show(
  "integers mapped",
  integersWithGaps()
    .map(n => n | 0)
    .join(),
);
const mine = [1.5, 2.5];
pushNothing(mine);
show("mine", JSON.stringify(mine));
show("mine sum", sum(mine));
show("mine by index", sumByIndex(mine));
show("texts", textsWithGaps().map(size).join());
show("pick in", addOne(pick([1, 2], 1)));
show("pick out", addOne(pick([1, 2], 2)));
show("pick text out", size(pick(["a"], 5)));
show("box", addOne(new Box<number>().get()));
show("box value", new Box<number>().value);
show("box full", addOne(new Box<number>(4).get()));
for (const [key, value] of counts) show("count " + key, addOne(value));
show("total", total);
show("total + 1", addOne(total));
show("port", settings.port);
show("port + 1", addOne(settings.port));
show("host", size(settings.host));
show("later", addOne(await later(true)));
show("later nothing", addOne(await later(false)));
