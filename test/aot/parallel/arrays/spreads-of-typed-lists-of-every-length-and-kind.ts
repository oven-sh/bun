const lines: string[] = [];
const show = (label: string, list: readonly unknown[]) =>
  lines.push(label + " " + list.length + " [" + list.map(item => (Object.is(item, -0) ? "-0" : String(item))).join() + "]");

function whole(length: number): number[] {
  const list: number[] = [];
  for (let k = 0; k < length; k++) list.push(k * 3 - 4);
  return list;
}
function fractions(length: number): number[] {
  const list: number[] = [];
  for (let k = 0; k < length; k++) list.push(k * 1.5 - 0.25);
  return list;
}
function mixed(length: number): number[] {
  const list: number[] = [];
  for (let k = 0; k < length; k++) list.push(k & 1 ? k : k + 0.5);
  return list;
}
const copyOf = (list: number[]): number[] => [...list];
const withLast = (list: number[], last: number): number[] => [...list, last];
const withFirst = (first: number, list: number[]): number[] => [first, ...list];
const both = (one: number[], other: number[]): number[] => [...one, ...other];

for (const length of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 33, 64, 100, 1000]) {
  for (const [kind, make] of [["whole", whole], ["fractions", fractions], ["mixed", mixed]] as const) {
    const list = make(length);
    const copy = copyOf(list);
    let sum = 0;
    for (let k = 0; k < copy.length; k++) sum += copy[k];
    copy.push(0.5);
    copy[0] = -1;
    lines.push(`${kind} ${length}: ${copy.length} ${sum} ${list.length} ${list[0]} ${copy[copy.length - 1]} ${copy === list}`);
    if (length <= 9) {
      show(kind + " copy", copyOf(list));
      show(kind + " last", withLast(list, 2.5));
      show(kind + " last whole", withLast(list, 7));
      show(kind + " first", withFirst(9, list));
      show(kind + " both", both(list, fractions(2)));
      show(kind + " itself", both(list, list));
    }
  }
}

const holeInWhole = [1, 2, , 4] as number[];
const holeInFractions = [1.5, , 3.5] as number[];
const holeAtTheEnd = [1.5, 2.5, ,] as number[];
const onlyHoles = new Array<number>(3);
for (const [label, list] of [["whole", holeInWhole], ["fractions", holeInFractions], ["end", holeAtTheEnd], ["only", onlyHoles]] as const) {
  const copy = copyOf(list);
  show("hole " + label, copy);
  lines.push("hole " + label + " own " + Object.keys(copy).join() + " | " + Object.keys(list).join());
  show("hole " + label + " last", withLast(list, 1));
}

show("special", copyOf([-0, 0, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31), 2 ** 53, 1e-320]));
show("nan", copyOf([1.5, NaN, 2.5]));
show("minus zero", copyOf([-0]));
show("parsed whole", copyOf(JSON.parse("[1,2,3]")));
show("parsed fractions", copyOf(JSON.parse("[1.5,2.5]")));
show("parsed lie", copyOf(JSON.parse('[1,"two",null,{"three":3}]')));
show("mapped", copyOf([1, 2, 3].map(item => item / 2)));
show("from", copyOf(Array.from({ length: 4 }, (_, k) => k)));
show("filled", copyOf(new Array<number>(5).fill(1.25)));
show("sliced", copyOf(fractions(6).slice(2)));
const shrunk = fractions(8);
shrunk.length = 3;
show("shrunk", copyOf(shrunk));
const grown = whole(2);
grown.length = 4;
show("grown", copyOf(grown));
const sparse: number[] = [];
sparse[5000] = 1.5;
lines.push("sparse " + copyOf(sparse).length + " " + copyOf(sparse)[5000] + " " + copyOf(sparse)[1]);
const frozen = Object.freeze(fractions(3)) as number[];
const thawed = copyOf(frozen);
thawed.push(1);
show("frozen", thawed);

let kept: number[][] = [];
for (let round = 0; round < 20000; round++) {
  const copy = copyOf(round & 1 ? fractions(round & 15) : whole(round & 15));
  if ((round & 1023) === 0) kept.push(copy);
}
lines.push("kept " + kept.map(list => list.join("/")).join(" "));
console.log(lines.join("\n"));
