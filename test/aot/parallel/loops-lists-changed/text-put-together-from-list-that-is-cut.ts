// A text is put together from the elements of a list of texts, up to the length the list had. One turn cuts the list, so the later turns append "undefined".
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(names: string[], at: number): string {
  const n = names.length;
  let text = names[0]!;
  for (let j = 1; j < n; j++) {
    if (j === at) names.length = j;
    text += "," + names[j];
  }
  return text;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(["a" + i, "b", "c" + i, "d", "e"], i % 7).length);
console.log(total, work(["a", "b", "c", "d"], 2), work(["a", "b", "c", "d"], 9));
