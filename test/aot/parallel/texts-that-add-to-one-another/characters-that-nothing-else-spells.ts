const seen: string[] = [];
function use(text: string) {
  seen.push(text);
}
function sumOf(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return sum;
}
function tell() {
  console.log(seen.length, seen.map(text => text.length + ":" + sumOf(text)).join(" "));
  console.log(JSON.stringify(seen[0]), JSON.stringify(seen[seen.length - 1].slice(-12)));
}
function row(a: string): number {
  let s = a.toUpperCase();
  use(s);
  s = s + "jkl".toUpperCase();
  use(s);
  s = s + "mno".toUpperCase() + 7;
  use(s);
  return s.length;
}
console.log(row("ghi"));
tell();
console.log(seen.map(text => text.charAt(text.length - 1) + text[0] + text.at(-2)).join(" "));
