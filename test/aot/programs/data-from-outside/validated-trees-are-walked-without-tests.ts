// validate<T> copies a parsed value as objects of T's layout. Here nothing else ever stores into those objects and they reach no unknown code, so the reads in the loops need no test.
// Whatever the run time cannot copy as the layout (more keys than the type names, keys in another order, a value that does not fit its slot) has to be read right all the same.
import { validate } from "bun:bundle";
type Forked = { left: Forked | null; right: Forked | null };
type Counted = { count: number; next: Counted | null };

function depthOf(top: Forked): number {
  let depth = 0;
  for (let at: Forked | null = top; at; at = depth % 2 ? at.left : at.right) depth++;
  return depth;
}
function sumOf(top: Counted): number {
  let sum = 0;
  for (let at: Counted | null = top; at; at = at.next) sum += at.count;
  return sum;
}

const forks = [
  '{"left":{"left":null,"right":null},"right":{"left":null,"right":null}}',
  '{"right":{"right":null,"left":null},"left":{"left":null,"right":{"left":null,"right":null}}}',
  '{"left":{"left":null,"right":null,"extra":1},"right":{"left":null,"right":null},"more":2}',
  '{"a":1,"left":null,"b":2,"right":{"c":3,"right":null,"d":4,"left":{"left":null,"right":null}}}',
  '{"left":null,"right":null}',
];
for (const text of forks) console.log(depthOf(validate<Forked>(JSON.parse(text))));

const counts = [
  '{"count":1,"next":{"count":2,"next":{"count":3,"next":null}}}',
  '{"count":1.5,"next":{"count":-0,"next":{"count":2147483648,"next":null}}}',
  '{"next":{"next":null,"count":1e300},"count":-2147483649}',
  '{"count":7,"next":null,"other":"x"}',
];
for (const text of counts) console.log(sumOf(validate<Counted>(JSON.parse(text))));

for (const text of ['{"left":1,"right":null}', '{"left":null}', "[]", "null", '{"left":{"left":null},"right":null}']) {
  try {
    console.log(depthOf(validate<Forked>(JSON.parse(text))));
  } catch (error: any) {
    console.log(error.name);
  }
}

const exact = [counts[0], counts[1], counts[3]];
let total = 0;
for (let round = 0; round < 2000; round++) total += depthOf(validate<Forked>(JSON.parse(forks[round % forks.length]))) + sumOf(validate<Counted>(JSON.parse(exact[round % exact.length])));
console.log(total);
