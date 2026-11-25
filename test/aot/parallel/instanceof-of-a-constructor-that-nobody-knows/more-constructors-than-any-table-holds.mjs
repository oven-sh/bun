const marks = []; function mark(text) { marks.push(text); }
function count(list, Kind) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Kind) hits += 1 << i; return hits; }
function say(when, does) { let told; try { told = does(); } catch (error) { told = "threw " + error.constructor.name + ": " + error.message; } console.log(when, told, marks.splice(0).join(" . ")); }
const kinds = [], things = [];
for (let i = 0; i < 300; i++) {
  const Kind = i % 3 === 0 ? class { static ["member" + i] = i; } : i % 3 === 1 ? function () {} : class extends (kinds[i - 2]) {};
  if (i % 3 === 1) Kind["member" + i] = i;
  kinds.push(Kind);
  if (i % 7 === 0) things.push(new Kind());
}
globalThis.kept = kinds;
for (let turn = 0; turn < 5; turn++) {
  let sum = 0;
  for (let i = 0; i < globalThis.kept.length; i++) sum = (sum * 31 + count(things, globalThis.kept[i])) % 1000003;
  console.log(turn, sum);
  if (turn === 2) for (let i = 0; i < kinds.length; i += 5) { if (i % 3 === 1) kinds[i].prototype = kinds[(i + 3) % 300].prototype; else Object.defineProperty(kinds[i], Symbol.hasInstance, { value: () => true }); }
  if (turn === 3) Bun.gc(true);
}
