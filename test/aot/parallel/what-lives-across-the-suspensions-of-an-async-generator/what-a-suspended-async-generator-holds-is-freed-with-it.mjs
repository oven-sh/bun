// What an async generator holds across a yield or an await lives as long as the generator needs it and no longer: dropped generators are collected with what they hold; what is dead behind a suspension is let go while the generator lives on.
// Under: --aot-check=Validate: behind each suspension the body names anew what it reads out of its frame in the heap; a compiler that checks itself looks at every such name
const later = value => new Promise(resolve => setTimeout(resolve, 0, value));
const made = { held: [], early: [], late: [] };
async function* holder(index, waits) {
  const early = { index, kind: "early", fill: new Array(64).fill(index) };
  const late = { index, kind: "late", fill: new Array(64).fill(-index) };
  made.early.push(new WeakRef(early)); made.late.push(new WeakRef(late));
  const first = yield early.fill.length + index;
  if (waits) await later(first);
  const second = yield late.fill.length;
  yield late.index + second;
}
async function collect() { for (let round = 0; round < 4; round++) { Bun.gc(true); await later(0); } }
const alive = list => list.filter(ref => ref.deref() !== undefined).length;
const most = (count, of) => count >= of * 0.9 ? "most" : count <= of * 0.1 ? "few" : "some " + count;

async function fill(count, steps, keep) {
  const kept = [];
  for (let index = 0; index < count; index++) {
    const it = holder(index, index % 2 === 0);
    made.held.push(new WeakRef(it));
    for (let step = 0; step < steps; step++) await it.next(step);
    if (keep) kept.push(it);
  }
  return kept;
}
const lines = [];
for (const [steps, keep] of [[0, false], [1, false], [2, false], [1, true], [2, true]]) {
  made.held.length = made.early.length = made.late.length = 0;
  const kept = await fill(100, steps, keep);
  await collect();
  lines.push([steps, keep, "generators", most(alive(made.held), 100), "early", made.early.length ? most(alive(made.early), made.early.length) : "none", "late", made.late.length ? most(alive(made.late), made.late.length) : "none", kept.length].join(" "));
  let sum = 0; for (const it of kept) sum += (await it.next(5)).value;
  lines.push("went on " + sum);
}
console.log(lines.join("\n"));
