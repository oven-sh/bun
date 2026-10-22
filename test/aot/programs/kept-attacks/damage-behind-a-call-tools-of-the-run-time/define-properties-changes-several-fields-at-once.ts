// Object.defineProperties makes one field an accessor, one read-only and one non-enumerable in a single call, below a call of a typed function whose caller has read all three.
class Triple {
  a: number;
  b: number;
  c: number;
  constructor(a: number, b: number, c: number) {
    this.a = a;
    this.b = b;
    this.c = c;
  }
}

let strikes = false;
function below(t: Triple): number {
  if (strikes) {
    Object.defineProperties(t, {
      a: { get: () => -1, configurable: true },
      b: { value: -2, writable: false },
      c: { enumerable: false },
    });
  }
  return 1;
}

function holder(t: Triple): string {
  const before = t.a + t.b + t.c;
  const got = below(t);
  const read = t.a + "," + t.b + "," + t.c;
  let stored = "stored";
  try {
    t.c = 9;
    t.b = 8;
  } catch (error) {
    stored = (error as Error).name;
  }
  return before + " " + got + " " + read + " " + stored + " " + t.b + "," + t.c + " " + Object.keys(t).join("") + " " + JSON.stringify(t);
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Triple(round, 1, 2));
  if (strikes || round === 0) console.log(round + ": " + line);
}
