// STATISTIC: IterationRestartsEmitted >= 1
// An element found at a position shows that the position lies inside the list, and a store there goes in line and asks nothing. A read behind such a store sees it where the two positions are one.
function meets(count: number, filled: number, last: number, turns: number, step: number): string {
  const list: number[] = new Array(count); for (let i = 0; i < filled; i++) list[i] = i * step;
  let total = 0;
  for (let i = 0; i < turns; i++) { const kept = list[i]!; const other = list[last - i]!; list[i] = other + 1; const again = list[last - i]!; list[last - i] = kept + again; total += list[i]! * 3 + list[last - i]!; }
  return total + " " + list.join();
}
function stays(count: number, filled: number, at: number, turns: number, step: number): string {
  const list: number[] = new Array(count); for (let i = 0; i < filled; i++) list[i] = i * step;
  let total = 0;
  for (let i = 0; i < turns; i++) { const here = list[i]!; const there = list[at]!; list[at] = here + there; total += list[i]! * 5 + list[at]!; list[i] = total % 11; total += list[at]!; }
  return total + " " + list.join();
}
for (const step of [3, 0.5]) for (const count of [1, 2, 5, 6, 9]) for (let filled = count - 1; filled <= count; filled++) for (const last of [0, 1, 2, 4, 5, 8]) for (const turns of [0, 1, 2, 3, 5])
  console.log(step, count, filled, last, turns, meets(count, filled, last, turns, step), "|", stays(count, filled, last, turns, step));
