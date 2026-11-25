// A number made in front of a loop divides an integer in the loop. Whatever the number is, the loop gives what plain Bun gives.
function sumOfRemainders(divisor: number, turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += i % divisor;
  return sum;
}

function intoView(divisor: number): number {
  const view = new Int32Array(4);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 1000; j++) view[i] = view[i] + (j % divisor);
  }
  return view[3];
}

function divisorBoundsTheCounterToo(divisor: number): number {
  let sum = 0;
  for (let j = 0; j < divisor && j < 50; j++) sum += j % divisor;
  return sum;
}

function dividendMayBeNegative(divisor: number): string {
  let zeros = 0;
  let sum = 0;
  for (let i = -6; i < 7; i++) {
    const remainder = i % divisor;
    if (Object.is(remainder, -0)) zeros++;
    sum += remainder;
  }
  return zeros + "/" + sum;
}

function divisorChangesInTheLoop(divisor: number): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += i % divisor;
    divisor = divisor - 1;
  }
  return sum;
}

let shared = 7;
function write(value: number) {
  shared = value;
}
function divisorIsWrittenByACallInTheLoop(next: number): number {
  shared = 7;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += i % shared;
    if (i === 5) write(next);
  }
  return sum;
}

function untyped(divisor: any): number {
  let sum = 0;
  for (let i = 0; i < 20; i++) sum += i % divisor;
  return sum;
}

const divisors = [40, 1, 2, 2147483647, 2147483648, 4294967303, 0, -0, -1, -3, -2147483648, 0.5, 2.5, NaN, Infinity, -Infinity];
for (const divisor of divisors) {
  console.log(
    Object.is(divisor, -0) ? "-0" : String(divisor),
    sumOfRemainders(divisor, 100),
    intoView(divisor),
    divisorBoundsTheCounterToo(divisor),
    dividendMayBeNegative(divisor),
    divisorChangesInTheLoop(divisor),
    divisorIsWrittenByACallInTheLoop(divisor),
    untyped(divisor),
  );
}
let asked = 0;
const object = {
  valueOf() {
    asked++;
    return 3;
  },
};
console.log(untyped("7"), untyped(null), untyped(undefined), untyped(true), untyped(object), asked, untyped([5]));
try {
  untyped(7n);
} catch (error) {
  console.log((error as Error).constructor.name);
}
