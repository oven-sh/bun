const base = p => String(p).replace(/^.*[\\/]/, "");
const known = () => [["ENTRY", module], ...(globalThis.objects ?? []).map((m, i) => ["PIECE" + i, m]), ...Object.entries(globalThis.leaves ?? {}).map(([n, m]) => ["LEAF-" + n, m])];
const others = [];
const who = m => { if (m === undefined || m === null) return String(m); const k = known().find(([, o]) => o === m); if (k) return k[0]; if (!others.includes(m)) others.push(m); return "OTHER" + others.indexOf(m) + "(" + base(m.id) + ")"; };
const list = m => "[" + m.children.map(c => who(c) === undefined ? "?" : who(c).startsWith("OTHER") ? base(c.id) : who(c)).join("+") + "]";
(async () => {
  require("./a.cjs");
  require("./piece.cjs");
  for (const [n, m] of Object.entries(globalThis.leaves ?? {})) console.log("SAID the parent of", n, "is", who(m.parent));
  (globalThis.objects ?? []).forEach((m, i) => console.log("SAID piece", i, "children", list(m)));
  console.log("SAID entry children", list(module));
  others.forEach((m, i) => console.log("SAID other", i, "id", base(m.id), "filename", base(m.filename), "loaded", m.loaded, "children", list(m), "parent", who(m.parent)));
})();
function namesThem() { return [require("./a.cjs")]; }
