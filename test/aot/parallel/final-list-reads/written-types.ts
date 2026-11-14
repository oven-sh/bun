const names: string[] = JSON.parse('["seen", "5", "length"]');
function distance(a: string, b: string): number {
  let previous: number[] = [];
  for (let j = 0; j <= b.length; j++) previous.push(j);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost));
    }
    previous = current;
  }
  return previous[b.length];
}
function ways(coins: number[], amount: number): number {
  const table: number[] = [1];
  for (let i = 1; i <= amount; i++) table.push(0);
  for (const coin of coins) for (let i = coin; i <= amount; i++) table[i] += table[i - coin];
  return table[amount];
}
Object.defineProperty(Array.prototype, names[0], { get() { return this; }, configurable: true });
const words = JSON.parse('["kitten", "sitting", "", "flaw", "lawn"]');
for (const a of words) console.log(words.map((b: string) => distance(a, b)).join());
for (const odd of JSON.parse('[[1, 2, 3], {"length": "seen"}, {"length": 2}, "abc"]')) {
  let got: any = "threw";
  try {
    got = distance("abc", odd);
    if (Array.isArray(got)) {
      (got as any[]).push("text");
      (got as any[])[0] = { a: 1 };
    }
  } catch (error) {
    got = (error as Error).constructor.name;
  }
  console.log(Array.isArray(got) ? got.map(String).join() : String(got));
}
console.log(ways([1, 2, 5], 11), String(ways([1, 2], JSON.parse('"3"'))), String(ways([2], "seen" as any)));
