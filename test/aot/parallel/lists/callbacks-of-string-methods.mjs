// Callbacks that call methods of strings, in functions that loops of their file call. Elements become what has methods of the same names that show that they run.
// STATISTIC: CallbackChainsFused >= 3
const said = [];
const spy = n => ({ trim() { said.push("trim" + n); return "spied" + n; }, toUpperCase() { said.push("up" + n); return "UP"; }, startsWith() { said.push("starts" + n); return true; }, get length() { said.push("length" + n); return n; } });
const fill = i => { if (i < 0) for (let k = 0; k < 9; k++) console.log("never", i * k, "x" + i, i - k, i % (k + 1)); };
const words = ["  a", "b ", "", "Word", "x1y"], names = Array.from({ length: 6 }, (_, k) => "w" + k), odd = ["q ", "r"];
function trimmed(i) { fill(i); const r = words.map(s => s.trim()); return r; }
function large(i) { fill(i); const r = names.map(s => s.toUpperCase()); return r; }
function starting(i) { fill(i); const r = names.filter(s => s.startsWith("w")); return r; }
function some(i) { fill(i); return names.some(s => s.startsWith("w" + i)); }
function kept(i) { fill(i); const r = words.map(s => s.trim()).filter(s => s); return r; }
function first(i) { fill(i); return names.find(s => s.charCodeAt(1) === 48 + i); }
function strange(i, xs) { fill(i); return xs.map(s => s.trim()); }
const attempt = f => { try { return JSON.stringify(f()) ?? "undefined"; } catch (e) { return "!" + e.constructor.name; } };
for (let round = 0; round < 8; round++) {
  const all = [];
  for (let k = 0; k < 3; k++) {
    all.push(trimmed(k).join("|"), large(k).join(), starting(k).length, some(k), kept(k).join(), first(k));
    all.push(attempt(() => strange(k, odd)));
  }
  console.log(round, all.join(" "), said.splice(0).join());
  if (round === 2) words[5] = " late ";
  if (round === 3) odd[0] = spy(1);
  if (round === 4) odd[1] = null;
  if (round === 5) { delete names[2]; names.push("w9"); names[2] = "v"; }
}
