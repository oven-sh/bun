// A generator and an async function rest in the turn; between two steps another caller stores the variable.
// STATISTIC: CapturedVariableReadsHoisted = 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function make() {
  let letters: string = through("aaaa");
  let seen = 0;
  function codeAt(at: number) { return letters.charCodeAt(at); }
  function* steps() { for (seen = 0; seen < 4; ++seen) { yield codeAt(seen); } }
  async function slowly() { let sum = 0; for (let at = 0; at < 4; ++at) { sum += codeAt(at); await null; } return sum; }
  return { steps, slowly, put(next: string) { letters = next; } };
}
(globalThis as any).kept = make();
const made: ReturnType<typeof make> = (globalThis as any).kept;
tell(() => { const all: number[] = []; const walk = made.steps(); for (let k = 0; k < 5; k++) { const step = walk.next(); all.push(step.done ? -1 : step.value as number); made.put("bcde".slice(0, 4 - k) + "zzzz"); } return all.join(","); });
made.put("aaaa");
const waits = made.slowly(); made.put("bbbb");
await waits.then(sum => said.push(String(sum)));
console.log(said.join(" | "));
