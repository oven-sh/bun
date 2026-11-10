// In the dead zone the turn calls a function that logs in front of the read.
// STATISTIC: FieldsOfScopesBehindTheirStoresReadInFrontOfTypedCopies >= 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function outer(turnsEarly: number) {
  const log: string[] = [];
  let seen = 0;
  const holder = { get mark() { log.push("g"); return 1; } };
  function note(i: number) { log.push("n" + i); }
  function measure(flag: boolean, turns: number): number {
    let total = 0;
    for (let i = 0; i < turns; i++) {
      note(i);
      if (flag) total += text.length & 7; else total += (text.length + 1) & 7;
      total += text.charCodeAt(i & 3) & 15;
    }
    return total;
  }
  (globalThis as any).held = measure;
  let early = "";
  try { early += (globalThis as any).held(true, turnsEarly); } catch (error: any) { early += error.constructor.name; }
  early += "/" + seen + "/" + log.join("");
  let text: string = through("abcd");
  return early + ":" + (globalThis as any).held(false, 3) + "/" + seen + "/" + log.join("");
}
for (const turns of [0, 1, 2, 3, 0]) tell(() => outer(turns));
console.log(said.join(" | "));
