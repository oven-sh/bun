import { createRequire } from "node:module";
const own = createRequire(import.meta.url);
const base = p => String(p).replace(/^.*[\\/]/, "");
const known = () => [...[], ...(globalThis.objects ?? []).map((m, i) => ["PIECE" + i, m]), ...Object.entries(globalThis.leaves ?? {}).map(([n, m]) => ["LEAF-" + n, m])];
const others = [];
const who = m => { if (m === undefined || m === null) return String(m); const k = known().find(([, o]) => o === m); if (k) return k[0]; if (!others.includes(m)) others.push(m); return "OTHER" + others.indexOf(m) + "(" + base(m.id) + ")"; };
const list = m => "[" + m.children.map(c => who(c).startsWith("OTHER") ? base(c.id) : who(c)).join("+") + "]";
const report = () => {
  for (const [n, m] of Object.entries(globalThis.leaves ?? {})) console.log("SAID leaf", n, "id", base(m.id), "loaded", m.loaded, "parent", who(m.parent), "children", list(m));
  (globalThis.objects ?? []).forEach((m, i) => console.log("SAID piece", i, "children", list(m)));
  for (const [n, m] of []) console.log("SAID", n, "children", list(m));
  for (let i = 0; i < others.length; i++) { const m = others[i]; console.log("SAID other", i, "id", base(m.id), "loaded", m.loaded, "children", list(m), "parent", who(m.parent)); }
};
const tools = { made: createRequire(import.meta.url) };
console.log("SAID got", JSON.stringify(tools.made("./a.cjs")));
report();
function keepInProgram() { return [own("./a.cjs")]; }
