// A loop reads a field of an object and makes a call in every iteration, so the test of the object can stand in front of the loop. In one iteration the callee makes the field an accessor that counts its reads.
class Meter {
  step: number;
  total: number;
  constructor(step: number) {
    this.step = step;
    this.total = 0;
  }
}

let reads = 0;
let strikeAt = -1;
function tick(meter: Meter, index: number): number {
  if (index === strikeAt) {
    Object.defineProperty(meter, "step", {
      get() {
        return ++reads;
      },
    });
  }
  return index & 1;
}

function run(meter: Meter): string {
  let sum = 0;
  for (let index = 0; index < 10; index++) {
    sum += meter.step;
    sum += tick(meter, index);
    sum += meter.step;
  }
  return sum + " " + meter.step;
}

for (let round = 0; round < 300; round++) {
  strikeAt = round % 100 === 99 ? 4 : -1;
  const line = run(new Meter(round));
  if (strikeAt >= 0 || round === 0) console.log(round + ": " + line + " " + reads);
}
