import { enterEveryWay } from "callers-without-types";

let fieldsFail = false;
function fail(): number {
  throw new SyntaxError("no value");
}
function start(): number {
  if (fieldsFail) throw new EvalError("no field");
  return 1;
}
class ThrowsInBody {
  value: number;
  constructor(list: number[], index: number) {
    if (index < 0) throw new RangeError("in front of the list");
    this.value = list[index] + 1;
  }
}
class ThrowsInDefault {
  value: number;
  constructor(list: number[], factor: number = fail()) {
    this.value = list[0] * factor;
  }
}
class ThrowsInField {
  value: number = start();
  constructor(list: number[]) {
    this.value += list[0];
  }
}
class ThrowsInFieldWithoutConstructor {
  value: number = start();
}
class HeirOfBody extends ThrowsInBody {
  constructor(list: number[], index: number) {
    super(list, index);
  }
}
class HeirOfDefault extends ThrowsInDefault {
  constructor(list: number[]) {
    super(list);
  }
}
class HeirOfField extends ThrowsInField {
  more: number = start();
}
function Plain(this: { value: number }, list: number[], index: number) {
  if (index < 0) throw new RangeError("in front of the list");
  this.value = list[index] + 1;
}
class HeirOfPlain extends (Plain as unknown as new (list: number[], index: number) => { value: number }) {
  constructor(list: number[], index: number) {
    super(list, index);
  }
}

console.log(
  new ThrowsInBody([1, 2], 1).value,
  new ThrowsInDefault([3], 2).value,
  new ThrowsInField([4]).value,
  new ThrowsInFieldWithoutConstructor().value,
  new HeirOfBody([5], 0).value,
  new HeirOfField([7]).more,
  new HeirOfPlain([8], 0).value,
);

const rows = [
  ...enterEveryWay("ThrowsInBody", ThrowsInBody, [
    [[1, 2], -1],
    [[1, 2], 1],
    ["text", -1],
    [undefined, 0],
  ]),
  ...enterEveryWay("ThrowsInDefault", ThrowsInDefault, [[[3]], [[3], 2], ["text"], [undefined, 2]]),
  ...enterEveryWay("HeirOfBody", HeirOfBody, [
    [[1, 2], -1],
    ["text", -1],
    [undefined, 0],
  ]),
  ...enterEveryWay("HeirOfDefault", HeirOfDefault, [[[3]], ["text"], [undefined]]),
  ...enterEveryWay("Plain", Plain, [
    [[1, 2], -1],
    ["text", -1],
    [undefined, 0],
  ]),
  ...enterEveryWay("HeirOfPlain", HeirOfPlain, [
    [[1, 2], -1],
    ["text", -1],
    [undefined, 0],
  ]),
];
fieldsFail = true;
rows.push(
  ...enterEveryWay("ThrowsInField", ThrowsInField, [[[4]], ["text"], [undefined]]),
  ...enterEveryWay("ThrowsInFieldWithoutConstructor", ThrowsInFieldWithoutConstructor, [[], [1]]),
  ...enterEveryWay("HeirOfField", HeirOfField, [[[4]], ["text"]]),
);
for (const row of rows) console.log(row);
