type Hive = { frames: number; wax: Uint32Array; rows: [from: number, till: number] | null };
const KINDS = 7;
const told: string[] = [];
function hive(): Hive {
  const frames = 11, rows = 43, wax = new Uint32Array(frames * rows);
  for (let place = wax.length - 1; place >= 0; place--) wax[place] = ((place * 13) % 29) * 8 + (place % 6 === 2 ? 5 : place % 3);
  return { rows: [2, rows], wax, frames };
}
function tapped(of: Hive, after: (of: Hive) => void): number {
  let honey = 0;
  if (of.rows === null) return honey;
  const [from, till] = of.rows, { frames } = of;
  let row = from;
  while (row < till) {
    for (let frame = frames; --frame >= 0;) {
      const cell = of.wax[frame + row * frames]!;
      if ((cell & KINDS) < 5) continue;
      honey = honey * 2 + (cell >>> 3) - (of.wax[frame + row * frames - 1] ?? 500) - (of.wax[frame + (row + 1) * frames] ?? 7);
      honey |= 0;
      if (honey % 5 === 0) after(of);
    }
    row++;
  }
  return honey;
}
const full = hive();
for (let turn = 0; turn < 50; turn++) told.push(String(tapped(full, () => {})));
const opened = hive(), half = (of: Hive) => { of.wax = of.wax.subarray(0, of.wax.length / 2); };
told.push(String(tapped(opened, half)), String(opened.wax.length), String(tapped(opened, half)), String(opened.wax.length));
const empty = hive();
told.push(String(tapped(empty, of => { structuredClone(of.wax.buffer, { transfer: [of.wax.buffer] }); })), String(empty.wax.length));
empty.rows = null;
told.push(String(tapped(empty, half)));
console.log(told.slice(0, 2).join(), told.slice(50).join());
