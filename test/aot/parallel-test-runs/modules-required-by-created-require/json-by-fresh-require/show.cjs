const path = require("node:path");
const id = m => m && m.id ? path.basename(m.id) : String(m && m.id);
const tree = m => id(m) + "[" + m.children.map(c => id(c) + (m.children.filter(d => d.id === c.id).length > 1 ? "!" : "") + (require.cache[c.id] === c ? "=" : "~")).join() + "]";
globalThis.tree = tree; globalThis.idOf = id;
