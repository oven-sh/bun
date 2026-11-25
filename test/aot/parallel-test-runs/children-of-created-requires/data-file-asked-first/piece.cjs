const { createRequire } = require("module");
class Tools { static made = createRequire(__filename); }
const m = Tools.made("./b.json");
const w = require("./b.json");
if (globalThis.never) require("./probe.cjs");
const probe = Tools.made("./probe.cjs");
const owner = probe.parent;
const seen = owner ? owner.children : [];
const name = x => require("path").basename(String(x.id));
console.log(seen.filter(x => module.children.includes(x)).map(name).join("+") || "-", m === w, m.name, owner === module, seen.map(name).join("+"), seen.map(x => !globalThis.showsCache || x === require.cache[x.id]).join("+"), new Set(seen).size, module.children.map(name).join("+"), module.children.map(x => !globalThis.showsCache || x === require.cache[x.id]).join("+"), seen.map(x => x.loaded).join("+"), seen.map(x => x.parent === owner).join("+"), seen.map(x => x.exports === (x.id.endsWith("probe.cjs") ? probe.exports : w)).join("+"));
