import { enterEveryWay } from "callers-without-types";

function sum(list: number[]): any {
  let total: any = 0;
  for (let index = 0; index < list.length; index += 1) total = total + list[index];
  return total;
}
function pick(list: number[], index: number): number {
  if (index < 0) throw new RangeError("in front of the list");
  return list[index] + 1;
}
function fail(): number {
  throw new SyntaxError("no default");
}
function scale(list: number[], factor: number = fail()): number {
  return list[0] * factor;
}
function half(value: number): number | undefined {
  if (value !== value) throw new EvalError("not a number");
  return value > 0 ? value / 2 : undefined;
}
function handOn(list: number[], index: number): number {
  return pick(list, index);
}

console.log(sum([1, 2, 3]) + 1, pick([4, 5], 1) + 1, scale([6], 2) + 1, (half(8) ?? 0) + 1, handOn([7], 0) + 1);

const rows = [
  ...enterEveryWay("sum", sum, [[undefined], [null], [[1, 2]], [{ length: 1, 0: "text" }], [Symbol.iterator]]),
  ...enterEveryWay("pick", pick, [
    [[1, 2], -1],
    [[1, 2], 1],
    ["text", -1],
    [undefined, 0],
    [[1, 2], -1.5],
  ]),
  ...enterEveryWay("scale", scale, [[[3]], [[3], undefined], [[3], 2], ["text"], [undefined, 2]]),
  ...enterEveryWay("half", half, [[NaN], [4], ["text"], [{}]]),
  ...enterEveryWay("handOn", handOn, [
    [[1, 2], -1],
    ["text", -1],
    [undefined, 0],
  ]),
];
for (const row of rows) console.log(row);
