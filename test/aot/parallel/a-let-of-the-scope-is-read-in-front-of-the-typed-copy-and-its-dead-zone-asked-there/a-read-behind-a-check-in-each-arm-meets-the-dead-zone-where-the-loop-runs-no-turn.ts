// A read behind two checks, one in each arm, in a loop that has a typed copy: called in front of the let with no turn nothing is read; with a turn a ReferenceError. Laid in front WITH its word the program dies (SIGSEGV).
// STATISTIC: FieldsOfScopesBehindTheirStoresReadInFrontOfTypedCopies >= 1
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function outer(turnsEarly: number) {
  function measure(flag: boolean, turns: number): number {
    let total = 0;
    for (let i = 0; i < turns; i++) {
      if (flag) total += text.length & 7; else total += (text.length + 1) & 7;
      total += text.charCodeAt(i & 3) & 15;
    }
    return total;
  }
  (globalThis as any).held = measure;
  const early = (globalThis as any).held(true, turnsEarly);
  let text: string = through("abcd");
  return early + ":" + (globalThis as any).held(false, 3);
}
tell(() => outer(0)); tell(() => outer(1)); tell(() => outer(0)); tell(() => outer(2));
console.log(said.join(" | "));
