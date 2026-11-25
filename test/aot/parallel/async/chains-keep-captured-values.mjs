// STATISTIC: ReactionChainsBuilt >= 2
// Captured values that only a chain of reactions holds live as long as a handler that uses them may run.
const nothing = () => Promise.resolve(undefined);
const waits = [];
const pending = v => new Promise(r => waits.push(() => r(v)));
let bad = 0, sum = 0;
function chain(k) {
  let a = { k }, b = [k, { deep: k }], c = "text" + k, d = null;
  return nothing()
    .then(() => { d = { k: a.k + 1 }; return k % 3 ? nothing() : pending({ p: k }); })
    .then(v => { if (b[1].deep !== k || (v && v.p !== k)) bad++; return Promise.resolve({ c: c + d.k, b }); })
    .then(v => { if (v.c !== "text" + k + (k + 1) || v.b !== b) bad++; return k % 5 ? v : pending(v); })
    .then(v => { if (v.b[0] !== k || a.k !== k || d.k !== k + 1) bad++; if (k % 7 === 0) throw { thrown: a }; return [v, a]; })
    .catch(e => { if (e.thrown !== a) bad++; return [0, a]; })
    .then(v => { if (v[1] !== a) bad++; sum += a.k; });
}
for (let round = 0; round < 40; round++) {
  const all = [];
  for (let k = 0; k < 150; k++) all.push(chain(round * 150 + k));
  const done = Promise.all(all);
  for (let t = 0; t < 12; t++) { await new Promise(r => setImmediate(r)); for (const f of waits.splice(0)) f(); }
  await done;
}
console.log("bad", bad, "sum", sum);
