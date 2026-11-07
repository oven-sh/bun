// literal-handed-on-between x own-proto-key-in-defaults

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
const DEFAULTS = { depth: 2, width: 80, ['__proto__']: { inherited: 1, color: 'above' } };
function A(i) { return { depth: i & 3 }; }
function B(i) { return { width: 1 }; }

function step(i) {  const target = {}; if ((i & 3) === 3) kept.push(target); const made = Object.assign(target, i & 1 ? { depth: i & 3 } : DEFAULTS); return made; }
function deed(i) {  }
for (let i = 0; i < 40; i++) {
  if (i === 20) tried("deed", () => deed(i));
  let made;
  try { made = step(i); } catch (e) { lines.push("step throws " + e.name); continue; }
  if (made && typeof made === "object") lines.push("first " + String(made.color) + "|" + String(made.name) + "|" + String(made.late) + "|" + String(made.inherited) + "|" + ("color" in made) + "|" + String(made.toString === Object.prototype.toString));
  
  if (made && typeof made === "object") lines.push("sum " + String(made.depth) + "|" + String(made.width) + "|" + String(made.color) + "|" + String(made.name) + "|" + String(made.late));
}
for (const k of kept) { lines.push("kept " + String(k.depth) + "|" + String(k.width) + "|" + String(k.color)); }
end();
