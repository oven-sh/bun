try {
  require("./piece.cjs");
} catch {}
const base = require("node:path").basename;
console.log("SAID children [" + globalThis.held.children.map(child => base(child.id)).join("+") + "] itself among them: " + globalThis.held.children.includes(globalThis.held) + " | parent " + (globalThis.held.parent === module ? "main" : String(globalThis.held.parent && base(globalThis.held.parent.id))) + " | children of main [" + module.children.map(child => base(child.id)).join("+") + "]");
