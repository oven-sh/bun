function counted(words: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}
const counts = counted(JSON.parse('["ash","elm","ash","fir","ash","elm"]'));
console.log([...counts].map(([word, count]) => word + count).join());
