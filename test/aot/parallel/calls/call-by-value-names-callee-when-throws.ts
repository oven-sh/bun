// The TypeError for `o.m(..)` names `m` also where the read and the call stay apart: unknown code runs between them (an argument with effects). The stub that calls a value knows no name: the throw finds it by the address of the call.
function hide<T>(value: T): T { return JSON.parse(JSON.stringify([0])).map(() => value)[0]; }
function report(o: any, label: string): string {
  const lines: string[] = [];
  const note = (what: string, run: () => unknown) => {
    try { lines.push(what + ": " + String(run())); } catch (e: any) { lines.push(what + ": " + e.constructor.name + " " + String(e.message).includes(what)); }
  };
  try { lines.push("nowhere: " + o.nowhere()); } catch (e: any) { lines.push("nowhere: " + e.constructor.name + " " + String(e.message).includes("nowhere")); }
  try { lines.push("withArguments: " + o.withArguments(1, label, lines.length)); } catch (e: any) { lines.push("withArguments: " + e.constructor.name + " " + String(e.message).includes("withArguments")); }
  try { lines.push("aNumber: " + o.aNumber()); } catch (e: any) { lines.push("aNumber: " + e.constructor.name + " " + String(e.message).includes("aNumber")); }
  try { lines.push("there: " + o.there(2)); } catch (e: any) { lines.push("there: " + e.constructor.name + " " + String(e.message).includes("there")); }
  note("inClosure", () => { const result = o.inClosure(); return result; });
  let order = "";
  try { o.afterArguments((order += "a", 1), (order += "b", 2)); } catch (e: any) { lines.push("afterArguments: " + e.constructor.name + " " + String(e.message).includes("afterArguments") + " " + order); }
  return label + " > " + lines.join(" | ");
}
class Thing { aNumber = 5; there(k: number) { return k * 2; } }
console.log(report(hide({ aNumber: 5, there: (k: number) => k + 1 }), "literal"));
console.log(report(hide(new Thing()), "instance"));
console.log(report(hide({}), "empty"));
console.log(report(hide([]), "array"));
console.log(report(hide("s"), "string"));
console.log(report(hide(5), "number"));
for (const nothing of [undefined, null]) { try { console.log(report(hide(nothing), "nothing")); } catch (e: any) { console.log(e.constructor.name); } }
let getterRuns = 0;
console.log(report(hide({ get nowhere() { getterRuns++; return undefined; }, get there() { getterRuns++; return (k: number) => k; } }), "getters"), getterRuns);
export {};
