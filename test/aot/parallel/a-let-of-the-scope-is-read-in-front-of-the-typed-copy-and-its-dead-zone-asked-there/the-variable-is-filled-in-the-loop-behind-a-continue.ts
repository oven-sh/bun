// The let stands in the body of the loop behind a continue: a turn that continues leaves it in its dead zone, the next fills it.
// STATISTIC: CapturedVariableReadsHoisted >= 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function run(turns: number) {
  let out = "";
  for (let k = 0; k < turns; k++) {
    const peek = (at: number) => text.charCodeAt(at);
    if (k % 2 === 0) { try { out += peek(0); } catch (error: any) { out += error.constructor.name; } continue; }
    let text: string = through("xyz".repeat(k));
    let sum = 0;
    for (let at = 0; at < text.length; at++) sum += peek(at) & 7;
    out += ":" + sum + ";";
  }
  return out;
}
(globalThis as any).kept = run;
for (let turn = 0; turn < 3; turn++) tell(() => (globalThis as any).kept(5));
console.log(said.join(" | "));
