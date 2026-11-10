// The function is called in front of the let: with no turn nothing is read and nothing is thrown; with one turn a ReferenceError; behind the let it counts.
// STATISTIC: FieldsOfScopesBehindTheirStoresReadInFrontOfTypedCopies >= 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function outer(turnsEarly: number) {
  function measure(flag: boolean, turns: number) { let total = 0; for (let i = 0; i < turns; i++) { total += flag ? text.length : text.length + 1; total += text.length; } return total; }
  (globalThis as any).held = measure;
  const early = (globalThis as any).held(true, turnsEarly);
  let text = through("abcd");
  return early + ":" + (globalThis as any).held(false, 3);
}
tell(() => outer(0)); tell(() => outer(1)); tell(() => outer(0)); tell(() => outer(2));
console.log(said.join(" | "));
