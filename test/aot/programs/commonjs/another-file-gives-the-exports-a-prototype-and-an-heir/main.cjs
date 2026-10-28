// Another file gives the exports a prototype and an heir.
const m = require("./m.cjs");
Object.setPrototypeOf(m, { inherited: "inherited", a: "shadowed by own" });
console.log(m.inherited, m.a, m.readInherited(), require("./other.cjs").see());
const heir = Object.create(m); heir.a = "heir's"; console.log(heir.a, m.a, heir.readA(), heir.readThis());
