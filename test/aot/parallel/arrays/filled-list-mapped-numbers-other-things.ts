// A filled list is mapped to numbers and then to other things.
function show(list: unknown[]): string {
  const parts: string[] = [];
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    parts.push(index in list ? (Object.is(item, -0) ? "-0" : typeof item === "string" ? JSON.stringify(item) : String(item)) : "hole");
  }
  return `${list.length}[${parts.join(",")}] ${Object.keys(list).join("")}`;
}
const lines: string[] = [];
const values: unknown[] = [0, 1.5, -0, NaN, Infinity, 2147483648, "a", undefined, null, true, 10n, { toString: () => "o" }];
for (let change = 0; change < 5; change++) {
  for (const value of values) {
    const order: string[] = [];
    const made = new Array(4).fill(value).map((item, index) => {
      order.push(`${index}${Object.is(item, value) ? "=" : "!"}`);
      return index < change ? index * 1.5 : item;
    });
    lines.push(`map ${change} ${order.join("")} ` + show(made));
    made[1] = "text";
    made.length = 6;
    made.push(7);
    lines.push("then " + show(made));
  }
}
for (const length of [0, 1, 2]) lines.push("short " + show(Array(length).fill(1).map((item, index) => item + index)));
const doubled = new Array<number>(6).fill(3).map((item, index) => item * index);
let sum = 0;
for (let index = 0; index < doubled.length; index++) {
  doubled[index] = doubled[index]! + 0.5;
  sum += doubled[index]!;
}
lines.push(`sum ${sum} ` + show(doubled) + " " + doubled.indexOf(9.5) + " " + JSON.stringify(doubled));
try {
  new Array(3).fill(0).map((_, index) => {
    if (index === 1) throw new RangeError("at one");
    return index;
  });
} catch (error) {
  const frames = ((error as Error).stack ?? "").split("\n").slice(0, 3);
  lines.push(frames.map(frame => frame.trim().replace(/\(.*[\\/]/, "(").replace(/native:\d+:\d+/, "native")).join(" | "));
}
const grid = new Array(2).fill(0).map((_, row) => new Array(3).fill(0).map((_, column) => row * 3 + column));
grid[1]![2] = -1;
lines.push("grid " + JSON.stringify(grid));
console.log(lines.join("\n"));
