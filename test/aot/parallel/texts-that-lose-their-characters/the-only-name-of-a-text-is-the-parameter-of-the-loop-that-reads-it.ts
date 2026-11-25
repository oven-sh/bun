// nobody but the reader holds the text, and behind the FlattenString in front of the loop the reader names it no more: the turns collect, and fill what is freed
function made(n: number) {
  return ("Ā" + "abcdefgh".repeat(n)).slice(1);
}
function churn() {
  Bun.gc(true);
  let sum = 0;
  for (let i = 0; i < 400; i++) sum += ("Ā" + String(i % 10).repeat(800)).slice(1).charCodeAt(3);
  return sum;
}
function digest(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
    if ((i & 255) === 7) h = (h + churn()) | 0;
  }
  return h;
}
console.log(digest(made(100)), digest(made(101)), digest(made(102)));
