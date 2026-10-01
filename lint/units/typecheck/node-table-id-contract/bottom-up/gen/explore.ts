// Prints facts about _scripts/ast.json that the table generator relies on.
import { api } from "/workspace/ref/typescript-go/_scripts/schema.ts";

const prim = new Map<string, number>();
const kinds = new Map<string, string[]>();
let defs = 0;
let maxSlots = 0;
for (const node of api.nodes()) {
  defs++;
  for (const k of node.allKinds()) {
    const list = kinds.get(k.name) ?? [];
    list.push(node.name);
    kinds.set(k.name, list);
  }
  let n = 0;
  for (const m of node.members) {
    const t = m.type;
    const key = `${t.kind}:${t.baseKind()}:${m.goOnly ? "goOnly:" + m.rawType : t.kind === "primitive" ? t.name : ""}${m.listKind ? ":" + m.listKind : ""}`;
    prim.set(key, (prim.get(key) ?? 0) + 1);
    n++;
  }
  maxSlots = Math.max(maxSlots, n);
}
console.log("defs", defs, "max members", maxSlots);
console.log([...prim].sort().map(([k, v]) => `${v}\t${k}`).join("\n"));
const multi = [...kinds].filter(([, v]) => v.length > 1);
console.log("kinds with a def", kinds.size, "kinds with several defs", multi.length);
for (const [k, v] of multi) console.log("  ", k, v.join(","));
const all = api.kindElements().filter(e => e.name).map(e => e.name!);
console.log("kind elements", all.length, "markers", api.kindMarkers().length);
console.log("kinds without def:", all.filter(k => !kinds.has(k)).join(" "));
console.log("kind aliases", api.kindAliases().map(a => `${a.name}(${a.members.length}${a.range ? " range" : ""})`).join(" "));
