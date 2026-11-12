// A const text and a const bound of the scope around.
// STATISTIC: CapturedVariableReadsHoisted >= 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function makeCounter(text: string) {
  const letters = through(text);
  const stop = through(text.length);
  let seen = 0;
  function codeAt(at: number) { return letters.charCodeAt(at); }
  function run(): number { let sum = 0; for (seen = 0; seen < stop; ++seen) { if (codeAt(seen) === 32) sum++; } return sum; }
  return { run, seen: () => seen };
}
(globalThis as any).kept = makeCounter("a few words and a few more words");
for (let turn = 0; turn < 5; turn++) tell(() => (globalThis as any).kept.run() + ":" + (globalThis as any).kept.seen());
console.log(said.join(" | "));
