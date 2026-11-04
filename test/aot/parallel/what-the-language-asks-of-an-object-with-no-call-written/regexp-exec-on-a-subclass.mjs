class R extends RegExp { constructor(s) { super(s); this.n = 1; } exec(text) { this.n = "text"; return null; } }
function read(o) { return o.n + 1; }
const r = new R("a");
const out = [read(r)];
out.push(r.test("a"), read(r));
console.log(out.join(" | "));
