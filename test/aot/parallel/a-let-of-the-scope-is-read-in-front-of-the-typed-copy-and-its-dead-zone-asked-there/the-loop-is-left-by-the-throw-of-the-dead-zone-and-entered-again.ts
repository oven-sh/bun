// The first entry is thrown out of by the dead zone; it is caught, the variable is filled, the loop is entered again.
// STATISTIC: FieldsOfScopesBehindTheirStoresReadInFrontOfTypedCopies >= 1
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
function outer() {
  function measure(turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { if (i & 1) total += text.length & 7; else total += (text.length + 1) & 7; total += text.charCodeAt(i & 3) & 15; } return total; }
  (globalThis as any).held = measure;
  let out = "";
  for (let again = 0; again < 2; again++) { try { out += (globalThis as any).held(3) + ";"; } catch (error: any) { out += error.constructor.name + ";"; } }
  let text: string = through("abcd");
  for (let again = 0; again < 2; again++) { try { out += (globalThis as any).held(3) + ";"; } catch (error: any) { out += error.constructor.name + ";"; } }
  return out;
}
tell(outer); tell(outer);
console.log(said.join(" | "));
