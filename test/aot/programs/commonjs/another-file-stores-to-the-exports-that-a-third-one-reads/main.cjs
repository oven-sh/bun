// Another file stores to the exports that a third one reads.
const m = require("./m.cjs");
console.log(m.a, m.f(), m.readA());
m.a = "stored by main";
m.f = () => "f replaced by main";
console.log(m.a, m.f(), m.readA(), m.callF(), require("./other.cjs").see());
