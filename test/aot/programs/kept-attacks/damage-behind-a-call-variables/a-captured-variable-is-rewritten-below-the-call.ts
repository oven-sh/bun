// A function has local variables that a closure captures. It reads them, calls a function that was handed that closure long ago, and reads them again.
let kept: ((value: any) => void) | null = null;
let mode = 0;
function below(): number {
  if (mode === 1) kept!(1000);
  else if (mode === 2) kept!("text");
  else if (mode === 3) kept!(undefined);
  return 1;
}

function holder(start: number): string {
  let total: number = start;
  kept = value => {
    total = value;
  };
  const before = total + 1;
  const got = below();
  const after = total + 1;
  total = 3;
  return before + " " + got + " " + after + " " + typeof after + " " + total;
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(round);
  if (mode || round === 0) console.log(round + ": " + line);
}
