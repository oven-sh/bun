// At concat and slice on every storage kind.
const grownIntegers: number[] = [];
for (let i = 0; i < 5; i++) grownIntegers.push(i * 10);
const grownDoubles: number[] = [];
for (let i = 0; i < 5; i++) grownDoubles.push(i + 0.5);
const grownStrings: string[] = [];
for (let i = 0; i < 5; i++) grownStrings.push("s" + i);
const withHole: number[] = [1, 2, 3, 4, 5];
delete withHole[2];
const sparse: number[] = [];
sparse[100000] = 7;
const frozen: number[] = Object.freeze([1, 2, 3]) as number[];
class Stack extends Array<number> {}
const stack = Stack.from([1, 2, 3]) as Stack;

const numberLists: Array<[string, number[]]> = [
  ["literal integers", [10, 20, 30, 40, 50]],
  ["literal doubles", [0.5, 1.5, 2.5]],
  ["grown integers", grownIntegers],
  ["grown doubles", grownDoubles],
  ["hole", withHole],
  ["sparse", sparse],
  ["frozen", frozen],
  ["subclass", stack],
  ["empty", []],
];
const positions: number[] = [0, 1, 2, -1, -2, 4, 5, -5, -6, 1.5, -1.5, -0, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31), 2 ** 32, 2 ** 53, 100000];

function elementAt(list: number[], position: number): number | undefined { return list.at(position); }
function stringAt(list: string[], position: number): string | undefined { return list.at(position); }
function joined(first: number[], second: number[]): number[] { return first.concat(second); }
function joinedWithElement(first: number[], element: number): number[] { return first.concat(element); }
function sliceFrom(list: number[], from: number): number[] { return list.slice(from); }
function sliceBetween(list: number[], from: number, to: number): number[] { return list.slice(from, to); }
const show = (list: number[]) => (list.length > 12 ? `length ${list.length}, last ${list[list.length - 1]}` : JSON.stringify(list)) + (list instanceof Stack ? " Stack" : "");

for (let round = 0; round < 3; round++) {
  for (const [name, list] of numberLists) {
    console.log(name, "at", positions.map(position => String(elementAt(list, position))).join(" "));
    console.log(name, "slice", positions.map(position => show(sliceFrom(list, position))).join(" "));
    console.log(name, "slice to", positions.map(position => show(sliceBetween(list, 1, position))).join(" "));
    for (const [otherName, other] of numberLists) console.log(name, "concat", otherName, show(joined(list, other)));
    console.log(name, "concat element", show(joinedWithElement(list, 9)));
  }
  console.log(positions.map(position => String(stringAt(grownStrings, position))).join(" "));
  console.log(positions.map(position => String(stringAt(["a", "b", "c"], position))).join(" "));
}

const copy = joined([1, 2, 3], [4]);
copy[0] = 100;
const literalAgain = () => [1, 2, 3];
console.log(copy, literalAgain(), joined(literalAgain(), literalAgain()));
