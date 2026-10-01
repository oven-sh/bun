// Builds, from ast.json, the per-kind table of Go struct fields (own and embedded), for the probe.
import fs from "node:fs";
const ast = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_scripts/ast.json", "utf8"));
export const goKinds = ast.kinds.elements.map(e => (typeof e === "string" ? e : e.name)).filter(Boolean);
export const goKindIndex = new Map(goKinds.map((k, i) => [k, i]));
const bases = ast.bases;
function baseFields(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const b = bases[name];
  if (!b) throw new Error("no base " + name);
  let out = [];
  for (const e of b.extends ?? []) out = out.concat(baseFields(e, seen));
  for (const [fname, f] of Object.entries(b.fields ?? {})) {
    if (f.noGo) continue;
    out.push({ name: fname, ...f });
  }
  return out;
}
// kind name -> { def, fields: Map(goFieldName -> {list, type, goOnly}) }
export const byKind = new Map();
for (const [defName, def] of Object.entries(ast.nodes.definitions)) {
  const fields = new Map();
  const seen = new Set();
  for (const e of def.extends ?? []) for (const f of baseFields(e, seen)) fields.set(f.name, f);
  for (const m of def.members ?? []) {
    if (m.inherited) {
      const prev = fields.get(m.name);
      if (prev) fields.set(m.name, { ...prev, ...m });
      else if (m.name !== "Kind" && m.name !== "Flags") fields.set(m.name, m);
    } else fields.set(m.name, m);
  }
  let kinds = def.kind ?? defName;
  if (!Array.isArray(kinds)) kinds = [kinds];
  const memberOrder = (def.members ?? []).map(m => m.name);
  const entry = { defName, fields, memberOrder };
  for (const k of kinds) if (goKindIndex.has(k)) byKind.set(k, entry);
  // definitions with a kind union in the Kind member
  const kindMember = (def.members ?? []).find(m => m.name === "Kind" && Array.isArray(m.type));
  if (kindMember) for (const k of kindMember.type) byKind.set(k.replace("SyntaxKind.", ""), entry);
  if (def.instantiationAliases || def.typeParameters) entry.generic = true;
}
export const tokenEntry = byKind.get("Token") ?? { defName: "Token", fields: new Map(), memberOrder: [] };
if (import.meta.main) {
  for (const k of goKinds) {
    const e = byKind.get(k);
    if (e) console.log(k, e.defName, [...e.fields.keys()].join(","));
  }
}
