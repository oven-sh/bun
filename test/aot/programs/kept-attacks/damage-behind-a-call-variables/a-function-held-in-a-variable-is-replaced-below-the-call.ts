// A variable of the module holds a function, which typed code calls. A call in between stores another function, or something that is no function, into the variable.
let step: (n: number) => number = n => n + 1;
const original = step;
let mode = 0;
const noFunction: any = 5;
function below(): number {
  if (mode === 1) step = n => n * 100;
  else if (mode === 2) step = noFunction;
  return 1;
}

function holder(n: number): string {
  const before = step(n);
  const got = below();
  let after: string;
  try {
    after = "" + step(n);
  } catch (error) {
    after = (error as Error).name;
  }
  return before + " " + got + " " + after;
}

for (let round = 0; round < 300; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(round);
  step = original;
  if (mode || round === 0) console.log(round + ": " + line);
}
