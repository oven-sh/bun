const rows: string[] = [];
function gets(t: any, k: any) { return t.get(k); }
function has(t: any, k: any) { return t.has(k); }
function sets(t: any, k: any, v: any) { return t.set(k, v); }
function adds(t: any, k: any) { return t.add(k); }
function deletes(t: any, k: any) { return t.delete(k); }
const key = {}, other = {};
const own = { get(k: any) { return "own get " + typeof k; }, has(k: any) { return "own has " + typeof k; }, set(k: any, v: any) { return "own set " + typeof k + typeof v; }, add(k: any) { return "own add " + typeof k; }, delete(k: any) { return "own delete " + typeof k; } };
class Heir extends Map<any, any> { get(k: any) { return "heir " + String(super.get(k)); } }
function say(what: string, f: () => unknown) { let said: string; try { const v = f(); said = v instanceof Map || v instanceof Set || v instanceof WeakMap || v instanceof WeakSet ? "itself" : String(v); } catch (e) { said = (e as Error).constructor.name + ": " + (e as Error).message; } rows.push(what + ": " + said); }
for (let turn = 0; turn < 3; turn++) {
  const map = new Map<any, any>([[1, "one"], ["a", "text"], [key, "object"]]), set = new Set<any>([1, "a", key]), weakMap = new WeakMap<any, any>([[key, "weak"]]), weakSet = new WeakSet<any>([key]);
  const shadowed = new Map<any, any>([[1, "one"]]); (shadowed as any).get = () => "laid on the instance";
  const receivers: [string, any][] = [["map", map], ["set", set], ["weak map", weakMap], ["weak set", weakSet], ["own", own], ["heir", new Heir([[1, "one"]])], ["shadowed", shadowed], ["text", "text"], ["number", 5], ["null", null], ["undefined", undefined], ["list", [1]], ["bare", Object.create(null)]];
  for (const [name, t] of receivers) for (const k of [1, "a", key, other, undefined, NaN, -0]) {
    const at = turn + " " + name + " " + (typeof k === "object" ? (k === key ? "key" : "other") : Object.is(k, -0) ? "-0" : String(k));
    say(at + " get", () => gets(t, k)); say(at + " has", () => has(t, k)); say(at + " set", () => sets(t, k, turn)); say(at + " get again", () => gets(t, k)); say(at + " add", () => adds(t, k)); say(at + " delete", () => deletes(t, k)); say(at + " has again", () => has(t, k));
  }
}
console.log(rows.length + " rows\n" + rows.join("\n"));
export {};
