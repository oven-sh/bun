class A extends Array { constructor() { super(); this.n = 1; } join() { this.n = "text"; return "joined"; } }
function read(o) { return o.n + 1; }
const k = new A();
const out = [read(k)];
let got; try { got = `${k}`; } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
