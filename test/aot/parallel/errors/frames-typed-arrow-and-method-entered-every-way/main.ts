// A typed arrow function and a typed method are entered by a call, as bound functions and through proxies, and refused by new, by Reflect.construct and by super(..), from a package without types. Each row prints the names and the places of the frames of what is thrown.
import { enterEveryWay } from "callers-without-types";

const arrow = (list: number[], index: number): number => {
  if (index < 0) throw new RangeError("in front of the list");
  return list[index] * 2;
};
const holder = {
  method(list: number[], index: number): number {
    if (index < 0) throw new RangeError("in front of the list");
    return list[index] * 3;
  },
};

console.log(arrow([8], 0) + 1, holder.method([9], 0) + 1);

const rows = [
  ...enterEveryWay("arrow", arrow, [
    [[1, 2], -1],
    [[1, 2], 1],
    ["text", -1],
    [undefined, 0],
  ]),
  ...enterEveryWay("method", holder.method, [
    [[1, 2], -1],
    [[1, 2], 1],
    ["text", -1],
    [undefined, 0],
  ]),
];
for (const row of rows) console.log(row);
