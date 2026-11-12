function count(view: Int32Array, record: { from: number }, bound: number) {
  let turns = 0, kept = 0, read = 0;
  let i = record.from;
  while (i < bound) {
    if (++turns) i += 2;
    read = view[i & 7];
    kept = (kept + 0) | 0;
  }
  return read + kept + turns;
}
count(0 as any, 0 as any, (() => 1) as any);
console.log(count(new Int32Array(8), { from: 9007199254740983 }, 9007199254740985));
