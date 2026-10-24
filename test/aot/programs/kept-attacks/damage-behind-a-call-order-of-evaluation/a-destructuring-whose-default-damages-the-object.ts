// A destructuring pattern reads the properties of an object one after the other. The default value of the first one is a call, which damages the object before the others are read.
type Options = { first?: number; second: number; third: number };

let mode = 0;
function fallback(options: Options): number {
  if (mode === 1) delete (options as any).second;
  else if (mode === 2) (options as any).third = "T";
  else if (mode === 3) Object.defineProperty(options, "second", { get: () => -7 });
  return 100;
}

function holder(options: Options): string {
  const before = options.second + options.third;
  const { first = fallback(options), second, third } = options;
  return before + " " + first + "," + second + "," + third;
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder({ second: round, third: 1 }) + " | " + holder({ first: 5, second: round, third: 1 });
  if (mode || round === 0) console.log(round + ": " + line);
}
