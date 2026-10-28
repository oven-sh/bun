// Another file deletes an export and stores it again.
const m = require("./m.cjs");
console.log(delete m.a, m.a, "a" in m, Object.keys(m).join(), m.readA(), require("./other.cjs").see());
m.a = "back"; console.log(m.a, Object.keys(m).join(), m.readA(), require("./other.cjs").see());
