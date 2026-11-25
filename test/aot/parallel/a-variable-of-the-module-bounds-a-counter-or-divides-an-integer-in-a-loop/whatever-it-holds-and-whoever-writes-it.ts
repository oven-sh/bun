// A variable of the module bounds a counter or divides an integer in a loop that stands in a function. Whatever the variable holds, whoever writes it and whenever, the loop gives what plain Bun gives.
let bound = 0;
let divisor = 1;

function count(): number {
  let sum = 0;
  for (let i = 0; i < bound; i++) {
    if (i >= 100) break;
    sum += i & 7;
  }
  return sum;
}

function remainders(): number {
  let sum = 0;
  for (let i = 0; i < 50; i++) sum += i % divisor;
  return sum;
}

function boundDividesToo(): number {
  let sum = 0;
  for (let i = 0; i < bound; i++) {
    if (i >= 60) break;
    sum += i % bound;
  }
  return sum;
}

function aTurnWritesTheBound(): number {
  let sum = 0;
  for (let i = 0; i < bound; i++) {
    sum += i;
    if (i === 3) bound = 6;
    if (i >= 20) break;
  }
  return sum;
}

function aTurnWritesTheDivisor(): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += i % divisor;
    divisor = divisor - 1;
  }
  return sum;
}

function write(nextBound: number, nextDivisor: number) {
  bound = nextBound;
  divisor = nextDivisor;
}

function aCallInTheTurnWritesBoth(nextBound: number, nextDivisor: number): number {
  let sum = 0;
  for (let i = 0; i < bound; i++) {
    sum += i % divisor;
    if (i === 4) write(nextBound, nextDivisor);
    if (i >= 30) break;
  }
  return sum;
}

const kinds = [40, 1, 2, 0, -0, -1, -3, 0.5, 2.5, 99.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967303, -2147483648, 1e300];
for (const kind of kinds) {
  const line: (string | number)[] = [Object.is(kind, -0) ? "-0" : String(kind)];
  bound = kind;
  line.push(count(), boundDividesToo());
  divisor = kind;
  line.push(remainders());
  bound = kind;
  line.push(aTurnWritesTheBound(), bound);
  divisor = kind;
  line.push(aTurnWritesTheDivisor(), divisor);
  bound = 12;
  divisor = 5;
  line.push(aCallInTheTurnWritesBoth(kind, 3), aCallInTheTurnWritesBoth(9, kind));
  console.log(line.join(" "));
}

const steps: string[] = [];
function tooEarly(): string {
  try {
    let sum = 0;
    for (let i = 0; i < initializedLate; i++) sum += i;
    return "no error " + sum;
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function tooEarlyBehindAnEffect(): string {
  try {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      steps.push("turn " + i);
      sum += i % initializedLate;
    }
    return "no error " + sum;
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
console.log(tooEarly(), tooEarlyBehindAnEffect(), steps.join(","));
const initializedLate = Number("5");
console.log(tooEarly(), tooEarlyBehindAnEffect(), steps.join(","));

async function otherCodeWritesWhileTheLoopWaits(): Promise<number> {
  let sum = 0;
  for (let i = 0; i < bound; i++) {
    sum += i % divisor;
    await null;
  }
  return sum;
}
bound = 10;
divisor = 7;
const waiting = otherCodeWritesWhileTheLoopWaits();
queueMicrotask(() => {
  divisor = 0.5;
  bound = 6.5;
});
console.log(await waiting, bound, divisor);

function* aGeneratorIsResumedBehindAWrite(): Generator<number> {
  for (let i = 0; i < bound; i++) yield i % divisor;
}
bound = 5;
divisor = 3;
const made: number[] = [];
for (const value of aGeneratorIsResumedBehindAWrite()) {
  made.push(value);
  if (made.length === 2) {
    divisor = 0;
    bound = 4;
  }
}
console.log(made.join(","));
