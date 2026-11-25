function grade(mark: number): string {
  if (mark >= 90) return "a";
  if (mark >= 75) return "b";
  if (mark >= 60) return "c";
  return "f";
}
function tally(marks: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < marks.length; i++) {
    const key = grade(marks[i]);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
console.log(JSON.stringify(tally(JSON.parse("[95,80,61,40,77,90]"))));
