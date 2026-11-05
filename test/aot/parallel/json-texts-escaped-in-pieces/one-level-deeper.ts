// the long text lies in a row inside a row, in a list of rows, and behind other members: what was written in front of it moves along when the buffer is made anew
type Leaf = { label: string; body: string; done: boolean };
type Branch = { id: number; leaf: Leaf; tail: string };
type Tree = { name: string; branches: Branch[]; count: number };
function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
  return sum;
}
function reportBranch(branch: Branch, times: number): string {
  let length = 0;
  let sum = 0;
  for (let i = 0; i < times; i++) {
    const text = JSON.stringify(branch);
    length += text.length;
    sum = (sum + checksum(text)) | 0;
  }
  return length + " " + sum;
}
function reportTree(tree: Tree, times: number): string {
  let length = 0;
  let sum = 0;
  for (let i = 0; i < times; i++) {
    const text = JSON.stringify(tree);
    length += text.length;
    sum = (sum + checksum(text)) | 0;
  }
  return length + " " + sum;
}
function branch(id: number, body: string): Branch {
  return { id, leaf: { label: "leaf\t" + id, body, done: id % 2 === 0 }, tail: "end\n" };
}
console.log(reportBranch(branch(1, "a\nb"), 300));
console.log(reportTree({ name: "small", branches: [branch(1, "a\nb"), branch(2, "")], count: 2 }, 300));
for (const length of [70_000, 3_000_000]) {
  console.log(reportBranch(branch(3, "\n" + "x".repeat(length)), 1));
  console.log(reportBranch(branch(4, "\n" + "\u0100".repeat(length / 3)), 1));
  const branches = [branch(5, "x".repeat(length) + "\n"), branch(6, ""), branch(7, "\\".repeat(length / 10)), branch(8, "\u4e2d\n".repeat(length / 10))];
  console.log(reportTree({ name: "tall\n", branches, count: branches.length }, 1));
}
