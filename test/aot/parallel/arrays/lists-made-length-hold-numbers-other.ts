// Lists made by a length hold numbers and then other things.
function show(list: unknown[]): string {
  const parts: string[] = [];
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    parts.push(index in list ? (Object.is(item, -0) ? "-0" : typeof item === "string" ? JSON.stringify(item) : String(item)) : "hole");
  }
  return `${list.length}[${parts.join(",")}] ${Object.keys(list).join("")}`;
}
const lines: string[] = [];
const values: unknown[] = [0, 1.5, -0, NaN, Infinity, 2147483648, -2147483649, "a", undefined, null, true, 10n, { toString: () => "o" }];
for (const value of values) {
  for (const length of [0, 1, 3]) {
    const filled = new Array(length).fill(value);
    lines.push("fill " + show(filled));
    filled.push("more");
    filled[length + 2] = 7;
    lines.push("then " + show(filled));
  }
}
for (let change = 0; change < 5; change++) {
  for (const value of values) {
    const order: number[] = [];
    const made = Array.from({ length: 4 }, (_, index) => {
      order.push(index);
      return index < change ? index * 1.5 : value;
    });
    lines.push(`from ${change} ${order.join("")} ` + show(made));
    made[1] = "text";
    made.length = 6;
    lines.push("then " + show(made));
  }
}
const numbers = new Array<number>(5).fill(2);
let sum = 0;
for (let index = 0; index < numbers.length; index++) {
  numbers[index] = numbers[index]! * (index + 0.5);
  sum += numbers[index]!;
}
lines.push(`sum ${sum} ` + show(numbers));
const squares = Array.from({ length: 6 }, (_, index) => index * index);
squares.reverse();
squares.sort((a, b) => a - b);
lines.push("squares " + show(squares) + " " + squares.indexOf(9) + " " + squares.includes(NaN) + " " + JSON.stringify(squares));
try {
  Array.from({ length: 3 }, (_, index) => {
    if (index === 1) throw new RangeError("at one");
    return index;
  });
} catch (error) {
  const frames = ((error as Error).stack ?? "").split("\n").slice(0, 3);
  lines.push(frames.map(frame => frame.trim().replace(/\(.*[\\/]/, "(").replace(/native:\d+:\d+/, "native")).join(" | "));
}
const seen: unknown[] = [];
const late = Array.from({ length: 3 }, function (this: unknown, first: unknown, index: number) {
  seen.push(first, index, arguments.length, this === undefined);
  return index ? "s" + index : 0.25;
});
lines.push("late " + show(late) + " " + seen.join(","));
const frozen = Object.freeze(new Array(2).fill(4));
lines.push("frozen " + Object.isFrozen(frozen) + " " + show(frozen as unknown[]));
const nested = new Array(2).fill(0).map((_, row) => new Array(3).fill(row + 0.5));
nested[1]![2] = -1;
lines.push("nested " + JSON.stringify(nested));
console.log(lines.join("\n"));
