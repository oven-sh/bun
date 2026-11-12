const marks = []; function mark(text) { marks.push(text); }
function count(list, Kind) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Kind) hits += 1 << i; return hits; }
function say(when, does) { let told; try { told = does(); } catch (error) { told = "threw " + error.constructor.name + ": " + error.message; } console.log(when, told, marks.splice(0).join(" . ")); }
function round(seed) {
  const kinds = [];
  for (let i = 0; i < 40; i++) {
    const Kind = function () {};
    for (let j = 0; j <= (i + seed) % 5; j++) Kind["member" + seed + "x" + i + "x" + j] = j;
    if ((i + seed) % 2) Kind.prototype = { seed };
    kinds.push(Kind);
  }
  globalThis.kept = kinds;
  const things = kinds.map(Kind => new Kind());
  let sum = 0;
  for (let turn = 0; turn < 4; turn++) for (let i = 0; i < 40; i++) sum = (sum * 31 + count(things, globalThis.kept[i])) % 1000003;
  return sum;
}
for (let seed = 0; seed < 30; seed++) { console.log(seed, round(seed)); globalThis.kept = null; Bun.gc(true); }
