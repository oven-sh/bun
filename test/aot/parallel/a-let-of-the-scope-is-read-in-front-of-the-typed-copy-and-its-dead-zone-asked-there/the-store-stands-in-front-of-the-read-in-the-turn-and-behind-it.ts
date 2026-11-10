// The turn itself stores the variable, once in front of the read through the helper and once behind it.
// STATISTIC: CapturedVariableReadsHoisted = 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function make(first: boolean) {
  let letters: string = through("mnopqr");
  let seen = 0;
  function codeAt(at: number) { return letters.charCodeAt(at); }
  function run(texts: string[]): number {
    let sum = 0;
    for (seen = 0; seen < texts.length; ++seen) {
      if (first) letters = texts[seen];
      sum += codeAt(1);
      if (!first) letters = texts[seen];
    }
    return sum;
  }
  return run;
}
for (const first of [true, false, true, false]) { (globalThis as any).kept = make(first); tell(() => (globalThis as any).kept(through(["ab", "cd", "ef", "g"]))); }
console.log(said.join(" | "));
