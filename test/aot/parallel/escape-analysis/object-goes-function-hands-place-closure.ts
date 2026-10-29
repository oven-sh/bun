// An object goes to a function that hands it on in place of the closure over it and every pass is verified.
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

function run(seed: number): void {
  const scope = ((held: { value: number }) => {
    function peek(): void {
      say("peek", held.value);
    }
    return {
      work: (turn: number): void => {
        let seen = "";
        for (let at = 0; at < 4 + extraTurns; at++) {
          if (at === 2) seen += "," + held.value;
          [at].forEach(() => peek());
        }
        say(seen);
      },
      left: () => held.value,
    };
  })({ value: seed });
  for (const turn of [3, 1, seed].slice(extraTurns)) {
    scope.work(turn);
  }
  say(scope.left());
}
attempt("one", () => run(1));
attempt("two", () => run(2));
export {};

(globalThis as any)["keptForTheHost say"] = say;
(process as any).on("keptForTheHost tell", tell);
(globalThis as any)["keptForTheHost fail"] = fail;
(process as any).on("keptForTheHost attempt", attempt);
(globalThis as any)["keptForTheHost attemptLater"] = attemptLater;
(process as any).on("keptForTheHost run", run);
(globalThis as any)["keptForTheHost asks"] = (value: unknown) => [
  value instanceof (say as any),
  value instanceof (tell as any),
  value instanceof (fail as any),
  value instanceof (attempt as any),
  value instanceof (attemptLater as any),
  value instanceof (run as any),
];
