// A literal whose list is written goes to a callback in place of the closure over it and every pass is verified.
// Flags: --aot-check=verify-each-pass
const said: unknown[] = [];
function say(...seen: unknown[]): void {
  for (let at = 0; at < seen.length; at++) said.push(seen[at]);
}
function tell(label: string): void {
  let text = "";
  for (let at = 0; at < said.length; at++) text += (at ? "," : "") + String(said[at]);
  said.length = 0;
  console.log(label, text);
}
function fail(when: boolean): void {
  if (when) throw new RangeError("stop");
}
function attempt(label: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    say("threw", (error as Error).name);
  }
  tell(label);
}
async function attemptLater(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    say("threw", (error as Error).name);
  }
  tell(label);
}
const extraTurns: number = process.argv.length > 99 ? 1 : 0;

function inner(seed: number) {
  const scope = ((held: { list: number[] }) => {
    function peek(): void {
      held.list[0]++;
      say("peek", held.list[0]);
    }
    return {
      work: (turn: number): void => {
        let seen = "";
        for (let at = 0; at < 4 + extraTurns; at++) {
          if (at === 2) seen += "," + held.list[0];
          [at].forEach(() => peek());
        }
        say(seen);
      },
      left: () => held.list[0],
    };
  })({ list: [1, 2] });
  {
    scope.work(seed);
  }
  return scope.left();
}
function run(seed: number): void {
  for (let turn = 0; turn < 3 + extraTurns; turn++) say(inner(turn));
}
function seldom(seed: number): void {
  try {
    fail(seed > 0);
  } catch (error) {
    say("seldom", inner(seed + 5));
  }
}
{
  const all = new Set<string>();
  for (let round = 0; round < 300; round++) {
    try {
      run(round % 3);
    } catch (error) {
      say("threw");
    }
    all.add(said.join());
    said.length = 0;
  }
  console.log("often", [...all].join(" | "));
}
attempt("seldom", () => seldom(1));
attempt("seldom again", () => seldom(1));
attempt("seldom a third time", () => seldom(2));
attempt("one", () => run(1));
export {};

(globalThis as any)["keptForTheHost say"] = say;
(process as any).on("keptForTheHost tell", tell);
(globalThis as any)["keptForTheHost fail"] = fail;
(process as any).on("keptForTheHost attempt", attempt);
(globalThis as any)["keptForTheHost attemptLater"] = attemptLater;
(process as any).on("keptForTheHost inner", inner);
(globalThis as any)["keptForTheHost run"] = run;
(process as any).on("keptForTheHost seldom", seldom);
(globalThis as any)["keptForTheHost asks"] = (value: unknown) => [
  value instanceof (say as any),
  value instanceof (tell as any),
  value instanceof (fail as any),
  value instanceof (attempt as any),
  value instanceof (attemptLater as any),
  value instanceof (inner as any),
  value instanceof (run as any),
  value instanceof (seldom as any),
];
