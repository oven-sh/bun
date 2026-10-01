// Prints the facts of the model that the findings quote.
import { allDefs, problems } from "./model.ts";
const defs = allDefs();
let slots = 0, lates = 0, maxSlots = 0, maxLates = 0, unlisted = 0, text = 0;
const lateCount = new Map<string, number>();
for (const d of defs) {
  slots += d.slots.length;
  lates += d.lates.length;
  if (d.slots.length > maxSlots) maxSlots = d.slots.length;
  if (d.lates.length > maxLates) maxLates = d.lates.length;
  const listed = new Set(d.params.filter(p => p.kind === "slot").map(p => p.goName));
  for (const s of d.slots) if (!listed.has(s.goName) && d.params.length) { unlisted++; console.log("  unlisted slot", d.name, s.goName, s.slot); }
  if (d.hasText) text++;
  for (const l of d.lates) lateCount.set(l.goName, (lateCount.get(l.goName) ?? 0) + 1);
}
console.log(JSON.stringify({ defs: defs.length, slots, lates, maxSlots, maxLates, unlisted, defsWithText: text }));
console.log("late fields:", [...lateCount].map(([k, v]) => `${k}=${v}`).join(" "));
console.log("problems:", problems.length);
for (const p of problems) console.log("  ", p);
for (const name of ["FunctionDeclaration", "Identifier", "Token", "SourceFile", "JSDocParameterOrPropertyTag", "TemplateHead", "ClassDeclaration", "PropertyAccessExpression", "VariableDeclarationList", "JSDocText", "ForInOrOfStatement"]) {
  const d = defs.find(x => x.name === name)!;
  console.log(name, "kinds", d.kinds.slice(0, 4).join(","), d.kinds.length, "| params", d.params.map(p => `${p.rust}:${p.kind}${p.bitmask ? "&" + p.bitmask : ""}`).join(", "), "| slots", d.slots.map(s => `${s.rust}:${s.slot}${s.joined ? "(joined)" : ""}`).join(", "), "| late", d.lates.map(l => l.rust).join(","), "| children", d.children.map(c => `${c.index}:${c.visit}`).join(" "));
}
