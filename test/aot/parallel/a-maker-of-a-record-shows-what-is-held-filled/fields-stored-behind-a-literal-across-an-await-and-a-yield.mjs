async function one(n) { return n; }
async function waited(n) { const w = {}; w.first = await one(n); w.second = n + 1; return w; }
function readWaited(w) { return w.first + w.second; }

function* stepped(n) { const s = {}; s.before = n; yield s; s.after = n + 1; yield s; }
function readStepped(s) { return s.before + ":" + s.after; }

let last = "";
for (let turn = 0; turn < 300; turn++) {
  const lines = [readWaited(await waited(turn))];
  for (const s of stepped(turn)) lines.push(readStepped(s));
  last = lines.join(" | ");
}
console.log(last);
