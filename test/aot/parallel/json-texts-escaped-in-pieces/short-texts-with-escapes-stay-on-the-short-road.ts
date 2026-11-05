// short texts, most of them with something to escape, 30,000 times: the room for the longest escaped form is at hand, and each text is escaped in one go
type Note = { id: number; body: string; title: string };
function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
  return sum;
}
function report(notes: Note[], rounds: number): string {
  let length = 0;
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < notes.length; i++) {
      const text = JSON.stringify(notes[i]);
      length += text.length;
      sum = (sum + checksum(text)) | 0;
    }
  }
  return length + " " + sum;
}
const bodies = ["", "a", "a\nb", 'say "hi"', "c:\\temp\\x", "tab\there", "\u0000", "caf\u00e9\n", "\u65e5\u672c\n", "\ud83d\ude00", "\ud83d", "line one\nline two\nline three\nline four\nline five\nline six\nline seven\n"];
const notes: Note[] = [];
for (let i = 0; i < bodies.length; i++) notes.push({ id: i, body: bodies[i], title: bodies[bodies.length - 1 - i] });
console.log(report(notes, 2_500));
