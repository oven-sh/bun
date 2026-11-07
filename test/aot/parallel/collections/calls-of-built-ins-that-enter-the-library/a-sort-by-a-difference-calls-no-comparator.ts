// STATISTIC: SortsThatCallNoComparator >= 2
// STATISTIC: LibraryFunctionsEnteredBehindRows >= 2
// `(a, b) => a - b` and `(a, b) => b - a` on lists as made: the library sorts a short list of numbers where it lies, without one call.
function sorted(seed: number) {
  const upward: number[] = [], downward: number[] = [];
  for (let i = 0; i < 20; i++) { upward.push((i * 7 + seed) & 31); downward.push(((i * 11 + seed) & 31) + 0.5); }
  upward.sort((a, b) => a - b);
  downward.sort((a, b) => b - a);
  return upward.join() + " " + downward.join();
}
for (let seed = 0; seed < 3; seed++) console.log(sorted(seed));
