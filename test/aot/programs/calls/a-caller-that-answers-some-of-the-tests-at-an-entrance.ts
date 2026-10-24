// A function with typed parameters is entered through tests. A caller that has proven some of its operands enters behind the tests that it has answered,
// and whatever arrives for the others, through `any`, still gets the answer of the language: the tests that are left send it to the generic version.
// Built without inlining, so that the calls stay calls, with all code counted as hot, so that a shorter entrance pays, and with the compiler's own checks behind every pass.
class Box {
  constructor(public name: string, public size: number) {}
}
class Crate extends Box {
  constructor(name: string, size: number, public lid: boolean) {
    super(name, size);
  }
}

function combine(count: number, label: string, box: Box): string {
  return label + ":" + count * 2 + ":" + box.name + box.size;
}

function withProvenCountAndBox(count: number, label: any, box: Box): string {
  return combine(count, label, box);
}

function withProvenLabel(count: any, label: string, box: any): string {
  return combine(count, label, box);
}

function withNothingProven(count: any, label: any, box: any): string {
  return combine(count, label, box);
}

function withFewerArguments(count: number): string {
  try {
    return (combine as any)(count);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

function optional(first: number, second?: number, third: string = "d"): string {
  return first + "/" + second + "/" + third;
}

function callsOptional(first: number, second: any, third: any): string {
  return optional(first) + optional(first, second) + optional(first, second, third);
}

function descend(depth: number, trail: string, step: any): string {
  return depth <= 0 ? trail : descend(depth - 1, trail + step, step);
}

function makeCounter(start: number, unit: string) {
  function format(value: number, suffix: string): string {
    return unit + (start + value) + suffix;
  }
  function viaAny(value: number, suffix: any): string {
    return format(value, suffix);
  }
  return viaAny;
}

const labels: any[] = ["a", "b", 7, null, undefined, { toString: () => "object" }, ["x", "y"], true, 1.5, "c"];
const counts: any[] = [1, 2.5, "3", null, undefined, true, { valueOf: () => 9 }, -0, NaN, 4];
const boxes: any[] = [new Box("box", 1), new Crate("crate", 2, true), { name: "literal", size: 3 }, { name: 4, size: "five" }, new Box("again", 6)];

const seen = new Map<string, number>();
function note(text: string) {
  seen.set(text, (seen.get(text) ?? 0) + 1);
}

const counter = makeCounter(10, "#");
for (let turn = 0; turn < 3000; turn++) {
  const label = labels[turn % labels.length];
  const count = counts[turn % counts.length];
  const box = boxes[turn % boxes.length];
  note(withProvenCountAndBox(turn % 5, label, turn & 1 ? new Box("n", turn % 3) : new Crate("m", turn % 3, false)));
  note(withProvenLabel(count, "L" + (turn % 2), box));
  note(withNothingProven(count, label, box));
  note(withFewerArguments(turn % 2));
  note(callsOptional(turn % 3, count, label));
  note(descend(turn % 4, "t", label));
  note(counter(turn % 3, label));
}

for (const [text, times] of [...seen].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) console.log(times, text);
