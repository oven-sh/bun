// Every turn of `for (let ..)` has a fresh scope: a closure made in turn k keeps turn k's values, and an inner loop reads them through it.
// STATISTIC: CapturedVariableReadsHoisted >= 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function run(words: string[]) {
  const kept: (() => string)[] = [];
  let sum = 0;
  for (let k = 0, word = words[0]; k < words.length; k++, word = words[k]) {
    const codeAt = (at: number) => word.charCodeAt(at);
    kept.push(() => k + word);
    for (let at = 0; at < word.length; at++) sum += codeAt(at) & 15;
  }
  return sum + ":" + kept.map(one => one()).join(",");
}
(globalThis as any).kept = run;
for (let turn = 0; turn < 4; turn++) tell(() => (globalThis as any).kept(through(["alpha", "be", "gamma ray", ""])));
console.log(said.join(" | "));
