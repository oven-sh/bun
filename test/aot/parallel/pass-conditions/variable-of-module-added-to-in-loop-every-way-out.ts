// Loops in functions add to variables of the module that they read only behind the test that may end the loop. Whichever way a loop is left, and also where it takes no turn,
// whoever looks at the variable next finds what the last turn stored.
let plain = 0;
let left = 0;
let returned = 0;
let nested = 0;
let skipped = 0;
let reset = 0;
let fraction = 0.5;
let twice = 0;
let other = 100;

function adds(turns: number): void {
  for (let i = 0; i < turns; i++) plain += i & 3;
}

function leavesEarly(turns: number, end: number): void {
  for (let i = 0; i < turns; i++) {
    left += i;
    if (i === end) break;
    left += 1;
  }
}

function returnsFromLoop(turns: number, end: number): number {
  for (let i = 0; i < turns; i++) {
    returned += 2;
    if (i === end) return returned;
  }
  return -returned;
}

function addsInTwoLoops(rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) nested += row ^ column;
    nested += 1000;
  }
}

function skipsTurns(turns: number): void {
  for (let i = 0; i < turns; i++) {
    if (i & 1) continue;
    skipped += i;
  }
}

function startsAgain(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    reset += i & 3;
    if (reset > 64) {
      sum = (sum + reset) | 0;
      reset = 0;
    }
  }
  return sum;
}

function addsFractions(turns: number): void {
  for (let i = 0; i < turns; i++) fraction += 0.25;
}

function addsToTwo(turns: number): void {
  for (let i = 0; i < turns; i++) {
    twice += other;
    other -= 1;
  }
}

function show(label: string): void {
  console.log(label, plain, left, returned, nested, skipped, reset, fraction, twice, other);
}

for (const turns of [0, 1, 2, 7, 100, 0]) {
  adds(turns);
  show("adds " + turns);
  leavesEarly(turns, 3);
  show("leaves early " + turns);
  console.log(returnsFromLoop(turns, 5));
  show("returns " + turns);
  addsInTwoLoops(turns & 7, turns & 3);
  show("two loops " + turns);
  skipsTurns(turns);
  show("skips " + turns);
  console.log(startsAgain(turns * 10));
  show("starts again " + turns);
  addsFractions(turns);
  show("fractions " + turns);
  addsToTwo(turns);
  show("two variables " + turns);
}
