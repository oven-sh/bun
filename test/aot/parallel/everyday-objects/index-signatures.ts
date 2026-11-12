// Dictionaries with declared values, counted and turned into lists
interface Counts { [word: string]: number }
function count(text: string): Counts {
  const counts: Counts = {};
  for (const word of text.split(" ")) counts[word] = (counts[word] ?? 0) + 1;
  return counts;
}
function top(text: string, n: number): string {
  const entries = Object.entries(count(text)).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const sum = entries.reduce((total, [, value]) => total + value, 0);
  return entries.slice(0, n).map(([word, value]) => `${word}=${value}`).join(" ") + ` of ${sum}`;
}
console.log(top("a b a c b a", 2));
console.log(top("constructor x constructor", 5));
console.log(top("one", 1));
