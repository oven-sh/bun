import span, { sum, double, shout, low, step, Counter } from "./tools.js";

export function honest(round) {
  console.log(round, "sum", sum([1, 2, 3]), sum([]), sum(new Array(4, 5)), sum([0.5, 0.25]), sum(Array.of(6)));
  console.log(round, "double", double(1), double(2.5), double(-3), double(0), double(1e10));
  console.log(round, "span", span({ x: 3, y: 1 }), span({ x: 0.5, y: 0.25 }), span({ x: -1, y: -1 }), span({ x: 9, y: 4 }));
  console.log(round, "shout", shout("abc"), shout(""), shout("x" + round), shout(`${round}!`));
  console.log(round, "low", low(1), low(17), low(-1), low(255), low(16));
  console.log(round, "step", step(1), step(2), step(-1), step(0.5));
  console.log(round, "counter", new Counter(1).add(2), new Counter(0).add(0.5), new Counter(-1).add(1));
}
