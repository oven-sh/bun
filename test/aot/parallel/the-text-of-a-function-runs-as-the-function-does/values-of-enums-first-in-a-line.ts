// The value of a member of an enum stands in place of the read in what `toString()` gives, also where the read is the first thing in a line.
enum Level {
  Below = -1,
  Strict = "use strict",
}
const five = (): number => 5;
const cases: Record<string, [Function, ...unknown[]]> = {
  aNumberBelowZero: [function (a: unknown) { let b = a
    Level.Below.toFixed()
    return typeof b; }, five],
  aText: [function (this: unknown) { Level.Strict; return this === undefined; }],
  behindAnOperator: [function (a: unknown) { let b = a
    true && Level.Below.toFixed()
    return typeof b; }, five],
  behindATypeThatGoes: [function (a: unknown[], g: (x: number) => number) { let b = a
    type Gone = number;
    true && [1].map(g)
    return b === a; }, [0, [5]], (x: number) => x], // @ts-expect-error
  aVarWithAType: [function (a: number) { if (false) { var v: number = 1, w: string[] = []; } return [v, w, a]; }, 1],
};
const show = (run: () => unknown) => {
  try {
    return JSON.stringify(run()) ?? "undefined";
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
for (const [name, [f, ...given]] of Object.entries(cases)) {
  const again = new Function("return (" + String(f) + "\n)")();
  console.log(name + ": " + show(() => f(...given)) + " | " + show(() => again(...given)));
}
