// Native code calls functions with a rest parameter, so each rest array is made from the arguments in the frame. 1,000 of them hold no argument, 1,000 one, 1,000 two, and all stay alive.
// Arrays that grow afterwards hold what plain Bun's hold. The output is that of plain Bun.
const kept: unknown[][] = [];
const grown: unknown[][] = [];
const literals: number[][] = [];

function keep(...values: unknown[]): void {
  kept.push(values);
}

function grow(...values: unknown[]): void {
  for (let i = 0; i < 6; i++) values.push(values.length);
  grown.push(values);
}

for (let i = 0; i < 1000; i++) {
  queueMicrotask(keep);
  Promise.resolve(i).then(keep);
  setTimeout(keep, 0, i, -i);
}
for (let i = 0; i < 10; i++) {
  queueMicrotask(grow);
  Promise.resolve(i).then(grow);
}
for (let i = 0; i < 1000; i++) {
  const literal: number[] = [];
  if (i % 2 === 0) for (let j = 0; j < 4; j++) literal.push(i + j);
  literals.push(literal);
}

setTimeout(() => {
  const byLength = [0, 0, 0];
  let sum = 0;
  for (const values of kept) {
    byLength[values.length]++;
    for (const value of values) sum += value as number;
  }
  console.log(kept.length, byLength.join(","), sum);
  console.log(grown.map(values => values.join("")).join(" "));
  console.log(literals.length, literals[0].join(","), literals[1].length, literals[998].join(","));
}, 20);
