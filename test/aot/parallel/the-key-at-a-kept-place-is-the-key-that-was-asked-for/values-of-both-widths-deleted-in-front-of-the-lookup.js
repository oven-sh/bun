const texts = JSON.parse('["k0", "k2", "k7", "k19", "k299", "zz"]'), numbers = JSON.parse('[0, 2, 7, 19, 299, -1, 2.5]'), kinds = JSON.parse('["number", "text", "list", "nothing", "truth", "mixed"]');
function value(kind, i) { return kind === "number" ? i + 0.5 : kind === "text" ? "v" + i : kind === "list" ? [i] : kind === "nothing" ? undefined : kind === "truth" ? (i & 1) === 0 : i & 1 ? i : "m" + i; }
function probe(kind, size, wide, walks) {
  const m = new Map(); for (let i = 0; i < size; i++) m.set(wide ? i : "k" + i, value(kind, i));
  const asked = wide ? numbers : texts; let said = "";
  for (let j = 0; j < asked.length; j++) { const k = asked[j]; if (m.has(k)) { let n = 0; if (walks) for (const [x, y] of m) n++; m.delete(k); said += String(m.get(k)) + "/" + n + ";"; } else said += "-;"; }
  return said;
}
for (const kind of kinds) for (const size of [3, 8, 9, 20, 300]) for (const wide of [false, true]) for (const walks of [false, true]) { let said; try { said = probe(kind, size, wide, walks); } catch (e) { said = "THROWN " + e.name; } console.log("SAID " + kind + " " + size + " " + wide + " " + walks + " " + said); }
