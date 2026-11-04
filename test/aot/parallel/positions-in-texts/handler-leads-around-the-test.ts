// where the test fails something is thrown and caught, and the read follows
function codes(text: string): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    try {
      if (pos >= text.length) throw new Error("outside");
    } catch {
    }
    seen += text.charCodeAt(pos) + ",";
  }
  return seen;
}
function deed(): string {
  return codes("abc") + "|" + codes("");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
