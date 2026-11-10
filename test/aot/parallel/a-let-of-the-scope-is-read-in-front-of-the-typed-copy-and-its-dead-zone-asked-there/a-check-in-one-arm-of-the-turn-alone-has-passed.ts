// Only one arm of a condition in the turn reads the variable in front of the read that follows: the other arm reaches it unread.
// STATISTIC: FieldsOfScopesBehindTheirStoresReadInFrontOfTypedCopies >= 0
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function outer(early: boolean, flag: boolean) {
  function measure(turns: number) { let total = 0; for (let i = 0; i < turns; i++) { if (flag) total += text.length; total += text.charCodeAt(i & 3); } return total; }
  (globalThis as any).held = measure;
  const first = early ? (globalThis as any).held(2) : -1;
  let text = through("abcd");
  return first + ":" + (globalThis as any).held(4);
}
tell(() => outer(false, true)); tell(() => outer(false, false)); tell(() => outer(true, true)); tell(() => outer(true, false));
console.log(said.join(" | "));
