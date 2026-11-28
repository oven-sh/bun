// A row stores a constant and carries a number that only a test reads.
function clear(values: number[], width: number) {
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = 1.5;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      if (carried > 20) throw new RangeError("at " + at);
      values[at++] = 0.75;
    }
  }
}
function attempt(values: number[], width: number) {
  try {
    clear(values, width);
    console.log(values.join(" "));
  } catch (error) {
    console.log((error as Error).message, values.join(" "));
  }
}
const width = Number((globalThis as any).missing ?? 12);
const values: number[] = [];
for (let i = 0; i < 96; i++) values.push((i % 7) + 0.5);
attempt(values, width);
const large: number[] = [];
for (let i = 0; i < 96; i++) large.push(i + 0.5);
attempt(large, width);
