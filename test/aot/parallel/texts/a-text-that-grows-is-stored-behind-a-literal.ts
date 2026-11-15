type Mark = { n: number; seen?: string };
const unseen = (0, eval)("(x) => x") as <T>(x: T) => T;
function gather(count: number): string {
  const marks: Mark[] = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const mark: Mark = { n: i };
    mark.seen = line;
    marks.push(mark);
    line += "k" + i;
  }
  return marks[count - 1].seen + "/" + line;
}
console.log(gather(unseen(3)));
