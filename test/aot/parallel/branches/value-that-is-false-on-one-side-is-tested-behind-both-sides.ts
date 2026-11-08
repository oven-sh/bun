// a value that is the constant false on one side and what a getter answers on the other is tested behind both sides
type Box = { ok: unknown };
let reads = 0;
const box: Box = { get ok() { reads++; return reads % 3; } };
function subject(a: unknown, b: Box) { const ok = a ? b.ok : false; if (ok) return "yes"; return "no"; }
function deed(a: unknown) { return subject(a, box) + String(reads); }
console.log(deed(true), deed(false), deed(1), deed(""), deed("x"));
let yes = 0;
for (let i = 0; i < 300; i++) yes += subject(i % 4, box) === "yes" ? 1 : 0;
console.log(String(yes), String(reads));
Object.defineProperty(box, "ok", { get() { reads += 10; return null; } });
console.log(deed(JSON.parse("1")), deed(JSON.parse("0")));
