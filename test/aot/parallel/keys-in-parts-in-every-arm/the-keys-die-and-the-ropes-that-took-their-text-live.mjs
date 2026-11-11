const w = JSON.parse('{"head":"alphabet-soup-with-noodles-and-croutons-","tail":"-served-in-a-bowl-of-the-finest-porcelain","wide":"\\u03b2"}');
function join(left, right) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const held = [left + right];
  return held[work - 1];
}
function run(turns, mark) {
  let map = new Map();
  const kept = [];
  for (let i = 0; i < turns; i++) {
    map.set(join(w.head + mark + i, w.tail), i);
    const rope = join(w.head + mark + i, w.tail);
    if (map.get(rope) !== i) return -1 - i;
    kept.push(rope);
    if ((i & 127) === 127) { map = new Map(); Bun.gc(true); }
  }
  let same = 0;
  for (let i = 0; i < turns; i++) if (kept[i] === join(w.head + mark + i, w.tail)) same++;
  return same;
}
console.log(run(2048, ""), run(2048, w.wide));
