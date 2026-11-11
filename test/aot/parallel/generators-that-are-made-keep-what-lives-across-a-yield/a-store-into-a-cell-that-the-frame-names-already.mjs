let wrong = 0; const alive = [];
function* steps(id, turns) { for (let turn = 0; turn < turns; turn++) { const tag = id * 4096 + turn; const payload = { tag, twice: tag * 2 }; const box = { tag, held: null }; box.held = payload; for (let wait = 0; wait < 8; wait++) yield tag; if (box.held.tag !== tag || box.held.twice !== tag * 2) wrong++; } }
function* pairs(id, turns) { for (let turn = 0; turn < turns; turn++) { const first = { tag: turn, more: id + 1 }; const second = { tag: turn, more: id + 2 }; yield turn; if (first.more + 1 !== second.more) wrong++; } }
function run(make, count, turns) { alive.length = 0; for (let id = 0; id < count; id++) alive.push(make(id, turns)); let left = count, taken = 0;
  while (left) { left = 0; for (let id = 0; id < count; id++) { if (!alive[id].next().done) left++; taken++; } } return taken; }
const a = run(steps, 4096, 100), b = run(pairs, 4096, 800); console.log(wrong, typeof a, typeof b);
