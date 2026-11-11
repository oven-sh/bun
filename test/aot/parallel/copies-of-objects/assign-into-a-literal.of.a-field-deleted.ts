let log = "";
function show(o: any): string {
  if (o === null || typeof o !== "object") return String(o);
  let text = "";
  for (const key of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, key)!; text += String(key) + "=" + ("value" in d ? String(d.value) : "accessor") + (d.enumerable ? "" : "!e") + (d.writable === false ? "!w" : "") + (d.configurable ? "" : "!c") + " "; }
  const all = text + "|" + Object.keys(o).join() + "|" + (Object.getPrototypeOf(o) === Object.prototype) + "|" + Object.isFrozen(o) + log; log = ""; return all;
}
function tell(s: any): string { try { let last = ""; for (let k = 0; k < 3; k++) last = show(use(s, k)); return last; } catch (error) { const text = (error as Error).name + log; log = ""; return text; } }
function use(s: any, k: number): any { return Object.assign({ z: k }, s); }
function make(): any { return (() => { const o: any = { a: 1, b: 2 }; delete o.a; return o; })(); }
const kept: any = make();
(globalThis as any).kept = kept;
console.log(tell(kept));
console.log(tell(make()));

console.log(tell(kept));
console.log(tell(make()));
