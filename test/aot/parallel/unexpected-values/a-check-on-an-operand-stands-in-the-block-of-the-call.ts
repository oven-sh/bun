// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the judge of calls did not see the check that the caller lays on an operand in the block of the call
// What `weigh1` is handed is narrowed by two tests in blocks of their own; what the field can hold is asked of it right in front of the call.
const printValue = console.log;
const counts1: Record<string, number> = {};
function note1(text: unknown): void { const key = String(text); counts1[key] = (counts1[key] ?? 0) + 1; }
function weigh1(value: unknown): string { return value === undefined ? "U" : value === null ? "N" : typeof value === "function" ? "function" : typeof value === "object" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : typeof value + " " + String(value); }
class Crate1 { #tint: () => number; constructor(turn: number) { this.#tint = (() => turn & 3); } put(value: () => number): void { this.#tint = value; } get(): () => number { return this.#tint; } }
function tally1(turns: number): string {
  let holes = 0;
  const crate = new Crate1(turns);
  for (let turn = 0; turn < turns; turn++) {
    [turn].forEach(() => { crate.put(((turn & 2) !== 0 ? (() => turn & 3) : false) as any); });
    { const seen: unknown = crate.get(); if (seen === undefined || seen === null) holes++; else note1(weigh1(seen)); }
  }
  return holes + " holes " + JSON.stringify(counts1);
}
try { printValue("places 1", tally1(4)); } catch (error) { printValue("places 1 threw", (error as any)?.constructor?.name); }
try { printValue("places 1", tally1(400)); } catch (error) { printValue("places 1 threw", (error as any)?.constructor?.name); }
export {};
