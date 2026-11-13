function counted(text) {
  const counts = {};
  for (const word of text.split(" ")) {
    counts[word] = (counts[word] ?? 0) + 1;
  }
  return counts;
}
const counts = counted(JSON.parse('"a rose is a rose"'));
console.log(counts.rose, Object.keys(counts).join(), JSON.stringify(counts));
