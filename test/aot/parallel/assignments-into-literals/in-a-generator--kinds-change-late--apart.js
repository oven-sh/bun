// in-a-generator x kinds-change-late

const lines = [];
function show(label, o) {
  let above = "none";
  if (o !== null && typeof o === "object") { const p = Object.getPrototypeOf(o); above = p === Object.prototype ? "Object.prototype" : p === null ? "null" : "other:" + Object.keys(p).join("+"); }
  let text;
  try { text = JSON.stringify(o); } catch (e) { text = "throws " + e.name; }
  lines.push(label + " " + text + " keys=" + (o && typeof o === "object" ? Reflect.ownKeys(o).map(String).join(",") : "-") + " above=" + above);
}
function tried(label, f) { try { return f(); } catch (e) { lines.push(label + " throws " + e.name); return undefined; } }
function end() { const seen = new Map(); for (const l of lines) seen.set(l, (seen.get(l) ?? 0) + 1); for (const [l, n] of seen) console.log(n + " x " + l); }

const kept = [];
const DEFAULTS = { depth: 2, color: false, width: 80 };
function A(i) { return { depth: i & 3, name: 'a' }; }
function B(i) { return { width: i & 1, color: true }; }

function step(i) { if (i === -7) { lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); lines.push("pad" + i + lines.length); } function* g() { const s = i & 1 ? { depth: yield 1 } : { width: yield 2 }; return Object.assign({}, DEFAULTS, s); } const it = g(); const first = it.next().value; return it.next(first * 10).value; }
function deed(i) { DEFAULTS.depth = 'text'; DEFAULTS.width = 0.5; DEFAULTS.color = { on: true }; }
for (let i = 0; i < 40; i++) {
  if (i === 20) tried("deed", () => deed(i));
  let made;
  try { made = step(i); } catch (e) { lines.push("step throws " + e.name); continue; }
  if (made && typeof made === "object") lines.push("first " + String(made.color) + "|" + String(made.name) + "|" + String(made.late) + "|" + String(made.inherited) + "|" + ("color" in made) + "|" + String(made.toString === Object.prototype.toString));
  
  if (made && typeof made === "object") lines.push("sum " + String(made.depth) + "|" + String(made.width) + "|" + String(made.color) + "|" + String(made.name) + "|" + String(made.late));
}
for (const k of kept) { lines.push("kept " + String(k.depth) + "|" + String(k.width) + "|" + String(k.color)); }
end();
