// Each function reads its parameters again behind an operation whose slow way seldom runs. Here the slow way runs: a list changes the kind of
// its storage, grows, or gets a hole; a number does not fit; a name is looked for above a home object.
type Entry = { weight: number };

function put(list: number[], index: number, value: number): number {
  list[index] = value;
  return index * 10 + list.length;
}

function putAny(list: unknown[], index: number, value: unknown, tag: string): string {
  list[index] = value;
  return tag + index + ":" + list.length;
}

function add(list: Entry[], entry: Entry, next: Entry, count: number): number {
  list.push(entry);
  return next.weight + count + list.length;
}

function heavier(pair: { left: Entry; right: Entry }): Entry {
  return pair.left.weight > pair.right.weight ? pair.left : pair.right;
}
function pick(left: Entry, right: Entry): number {
  return heavier({ left, right }).weight * 100 + left.weight * 10 + right.weight;
}

function shout(prefix: string, text: string, suffix: string): string {
  return prefix + text.toUpperCase() + suffix + text.toLowerCase() + prefix;
}

class Base {
  name(): string {
    return "base";
  }
}
class Derived extends Base {
  name(): string {
    return "derived";
  }
  both(first: string, second: string): string {
    return first + super.name() + second + this.name() + first;
  }
}

function sum(first: number, second: number, third: number): number {
  const total = first * second;
  return (total | 0) === total ? total + third : total - third + second;
}

const lines: string[] = [];

const integers: number[] = [1, 2, 3];
lines.push("put " + put(integers, 1, 2.5) + " " + integers.join());
lines.push("put " + put(integers, 3, 4.5) + " " + integers.join());
lines.push("put " + put(integers, 6, NaN) + " " + integers.join());
const grown: number[] = [];
let puts = 0;
for (let index = 0; index < 300; index++) puts += put(grown, index, index + 0.5);
lines.push("puts " + puts + " " + grown[299]);

const mixed: unknown[] = [1, 2];
lines.push(putAny(mixed, 0, 1.5, "a"), putAny(mixed, 1, "text", "b"), putAny(mixed, 5, { weight: 1 }, "c"), JSON.stringify(mixed));

const entries: Entry[] = [];
let added = 0;
for (let index = 0; index < 300; index++) added += add(entries, { weight: index }, { weight: index * 2 }, index);
lines.push("added " + added + " " + entries.length + " " + entries[299].weight);

let picked = 0;
for (let index = 0; index < 300; index++) picked += pick({ weight: index % 7 }, { weight: index % 5 });
lines.push("picked " + picked);

lines.push(shout("<", "Straße ǅ x", ">"), shout("[", "plain", "]"));
lines.push(new Derived().both("(", ")"));
lines.push("sum " + sum(3, 4, 5) + " " + sum(1e9, 1e9, 7) + " " + sum(0.5, 3, 2));

console.log(lines.join("\n"));
