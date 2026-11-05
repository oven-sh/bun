// long texts with nothing to escape, narrow and wide, one after another in growing and in shrinking order
type Note = { id: number; body: string };
function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
  return sum;
}
function report(note: Note, times: number): string {
  let length = 0;
  let sum = 0;
  for (let i = 0; i < times; i++) {
    const text = JSON.stringify(note);
    length += text.length;
    sum = (sum + checksum(text)) | 0;
  }
  return length + " " + sum;
}
console.log(report({ id: 1, body: "ab" }, 300));
for (const length of [5_000, 70_000, 300_000, 5_000_000, 300_000, 70_000, 5_000, 5]) {
  console.log(report({ id: 2, body: "x".repeat(length) }, 3));
  console.log(report({ id: 3, body: "\u00fc".repeat(length) }, 3));
  console.log(report({ id: 4, body: "\u0100".repeat(length / 5) }, 3));
}
