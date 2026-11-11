// The variable is stored in the turn: straight by a helper, through a getter, and through a callback handed to a built-in.
// STATISTIC: CapturedVariableReadsHoisted = 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function make(how: number) {
  let letters: string = through("aaaaaaaaaa");
  let seen = 0;
  const holder = { get next() { letters = "b" + letters.slice(1); return 1; } };
  function codeAt(at: number) { return letters.charCodeAt(at); }
  function swap() { letters = "c" + letters.slice(1); }
  function run(): string {
    let sum = 0;
    for (seen = 0; seen < 6; ++seen) {
      sum += codeAt(0);
      if (seen === 2) { if (how === 0) swap(); else if (how === 1) sum += holder.next; else [1].forEach(() => { letters = "d" + letters.slice(1); }); }
      sum += codeAt(0);
    }
    return sum + ":" + letters;
  }
  return run;
}
for (const how of [0, 1, 2, 0, 1, 2]) { (globalThis as any).kept = make(how); tell(() => (globalThis as any).kept()); }
console.log(said.join(" | "));
