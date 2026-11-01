// An array literal under a tuple type is born for what its elements hold. It is an ordinary array all the same: whatever code
// that knows no types stores into it later is there to be read.
type Pair = [number, number];
type Named = [string, number, boolean?];
type Head = [number, ...string[]];

function sum(pair: Pair): number {
  return pair[0] + pair[1];
}

const pair: Pair = [3, 4];
console.log(sum(pair), pair.length, JSON.stringify(pair));

const loose: any = pair;
loose[1] = "four";
loose.push({ more: true }, undefined, null, 2.5);
console.log(JSON.stringify(pair), typeof pair[1], pair.length, String(sum(pair)));
loose.length = 1;
loose[3] = -0;
console.log(JSON.stringify(pair), 1 in pair, Object.is(loose[3], -0));

const named: Named = ["a", 1];
console.log(JSON.stringify(named), named[2], named.length);
named[2] = true;
console.log(JSON.stringify(named));

const head: Head = [1, "x", "y"];
head.push("z");
console.log(head.join("|"), typeof head[0], typeof head[3]);

const constant = [1, "two", false] as const;
console.log(constant[0] + 1, constant[1].length, !constant[2], JSON.stringify(constant));

interface Links {
  id: number;
  target?: Links;
}
const cached: [Links, string | undefined][] = [];
function remember(links: Links, text: string | undefined): void {
  cached.push([links, text]);
}
const first: Links = { id: 1 };
remember(first, "one");
remember({ id: 2, target: first }, undefined);
for (const [links, text] of cached) console.log(links.id, links.target?.id, text);
console.log(cached[1][0].target === cached[0][0]);

function swap<A, B>(both: [A, B]): [B, A] {
  return [both[1], both[0]];
}
console.log(JSON.stringify(swap([1, "a"])), JSON.stringify(swap(swap([{ deep: [1] }, null]))));

function prepend<T extends unknown[]>(value: number, rest: T): [number, ...T] {
  return [value, ...rest];
}
console.log(JSON.stringify(prepend(0, ["a", { b: 1 }, [2]])));

const halves: Pair = [0.5, 1];
halves[1] = 2 ** 40;
console.log(halves[0] + halves[1], JSON.stringify(halves));

const holes: [number?, number?, number?] = [, 2];
console.log(0 in holes, holes[0], holes[1], holes.length);

let total = 0;
for (let round = 0; round < 20000; round++) {
  const made: Pair = [round, round + 1];
  total += sum(made) + swap(made)[0];
}
console.log(total);
