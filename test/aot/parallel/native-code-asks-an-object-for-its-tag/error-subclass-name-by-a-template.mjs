class E extends Error { constructor() { super("m"); this.n = 1; } get name() { this.n = "text"; return "E"; } }
function read(o) { return o.n + 1; }
const k = new E();
const out = [read(k)];
let got; try { got = `${k}`; } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
