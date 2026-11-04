// a callee moves the captured position between the test and the read
let pos = 0;
function skip() {
  pos += 3;
}
function code(text: string, from: number): string {
  pos = from;
  if (pos < text.length) {
    skip();
    return String(text.charCodeAt(pos));
  }
  return "outside";
}
function deed(): string {
  return code("abcdef", 4) + "|" + code("abcdef", 1) + "|" + code("ab", 4);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
