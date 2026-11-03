// Flags: --aot-heat=everything-is-hot
// A loop in an inner function counts in two variables of the outer one, beside closures that read them. One is set back to 0 behind a test, so what a turn hands on
// comes through a join. The build made a copy of the loop for an integer `count`, the copy's `count` stayed a number, and the copy was copied, without end.
function scene(turns: number): string {
  let count = 0;
  let sum = 0;
  const peek = (): string => count + ":" + sum;
  function loop(n: number): string {
    for (let i = 0; i < n; i++) {
      count += i & 3;
      if (count > 64) {
        sum = (sum + count) | 0;
        count = 0;
      }
      sum += count;
    }
    return "ended " + count;
  }
  let text = "";
  for (let round = 0; round < turns; round++) text = loop(1000 + (round & 7)) + "@" + peek();
  return text;
}
console.log(scene(30));

// The first value is no int32, then a fraction, then no number.
function from(first: any, n: number): string {
  let count = first;
  let sum = 0;
  const peek = (): string => count + ":" + sum;
  const loop = (): void => {
    for (let i = 0; i < n; i++) {
      count += i & 3;
      if (count > 64) {
        sum = (sum + count) | 0;
        count = 0;
      }
      sum += count;
    }
  };
  loop();
  return peek();
}
console.log(
  from(0, 50),
  from(2 ** 31, 50),
  from(2 ** 53, 5),
  from(-(2 ** 31) - 1, 50),
  from(0.5, 50),
  from(-0, 1),
  from("7", 5),
  from(undefined, 5),
);
