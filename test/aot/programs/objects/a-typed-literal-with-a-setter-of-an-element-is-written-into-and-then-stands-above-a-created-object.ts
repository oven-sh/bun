const said: string[] = [];
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).constructor.name; } }

const victim = { la: { qb: 3 }, lb: 4, set 0(value: unknown) { said.push("0 is given " + String(value)); } };
type Victim = typeof victim;
function keysOneByOne(v: Victim): string { let la = 0, lb = 0, length = 0, others = ""; for (const key of Object.keys(v)) { if (key === "la") la++; else if (key === "lb") lb++; else if (key === "length") length++; else others += "+" + key; } return [la, lb, length, others].join(); }
function keysInALoop(v: Victim): string { let text = ""; for (const key in v) text += key === "la" || key === "lb" ? "." : key + ";"; return text; }
function tableByKeys(v: Victim): string { const table: Record<string, number> = { la: 1, lb: 2 }; return Object.keys(v).map(key => table[key]).join(); }
function ownNames(v: Victim): string { return Reflect.ownKeys(v).filter(name => name !== "la" && name !== "lb").map(String).join("+"); }
function values(v: Victim): string { return Object.values(v).map(each => typeof each).join(); }
function copied(v: Victim): string { return Object.keys({ ...v }).join("+"); }
function written(v: Victim): string { return JSON.stringify(v) ?? "nothing"; }
function asked(v: Victim): string { return ["la" in v, "nw" in v, "length" in v, 0 in v, Object.hasOwn(v, "length"), Object.hasOwn(v, 0)].join(); }
function laOfIt(v: Victim): string { return typeof v.la + " " + attempt(() => v.la.qb); }
function lbOfIt(v: Victim): string { return typeof v.lb + " " + attempt(() => v.lb + 1); }
function elements(v: Victim): string { const any: any = v; return typeof any.length + " " + String(any.length) + " " + String(any[0]) + " " + String(any[1]); }
function looks(v: Victim): string {
  return ["keysOneByOne " + attempt(() => keysOneByOne(v)), "keysInALoop " + attempt(() => keysInALoop(v)), "tableByKeys " + attempt(() => tableByKeys(v)), "ownNames " + attempt(() => ownNames(v)), "values " + attempt(() => values(v)), "copied " + attempt(() => copied(v)), "written " + attempt(() => written(v)), "asked " + attempt(() => asked(v)), "laOfIt " + attempt(() => laOfIt(v)), "lbOfIt " + attempt(() => lbOfIt(v)), "elements " + attempt(() => elements(v))].join("\n");
}
function road(): unknown { return Object.assign(victim, { la: "text", lb: { qb: 9 }, length: "long", 0: "zero", nw: 1 }); }
let before = "";
for (let turn = 0; turn < 60; turn++) before = looks(victim);
console.log(before);
console.log("road", attempt(() => { const answer = road(); return answer === victim ? "the object" : Array.isArray(answer) ? "[" + answer.join() + "]" : typeof answer; }));
console.log(looks(victim));
console.log("said", said.join("; "));
const heir = Object.create(victim); console.log(Object.keys(heir).length, typeof heir.lb, Object.getPrototypeOf(heir) === victim);
export {};
