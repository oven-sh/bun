// Members that are listed: operation one. It prints what plain Bun prints.
function none(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += i & 1;
  return sum;
}

const words: string[] = ["a", "b"];
function join(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += words.join("-").length;
  return sum;
}

function sin(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += Math.sin(i);
  return sum;
}

const point = { x: 1, y: 2 };
function keys(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += Object.keys(point).length;
  return sum;
}

const texts: string[] = ["Ab", "Cd"];
function lower(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += texts[i & 1].toLowerCase().length;
  return sum;
}

function own(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += Object.hasOwn(point, texts[i & 1]) ? 1 : 2;
  return sum;
}

const cases: Record<string, (rounds: number) => number> = { none, join, sin, keys, lower, own };
const which = process.argv[2] ?? "none";
const rounds = Number(process.argv[3] ?? 1000);
console.log(which, rounds, cases[which](rounds));
