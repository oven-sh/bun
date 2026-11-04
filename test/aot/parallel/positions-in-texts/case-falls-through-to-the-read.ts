// a case that has tested falls through to one that the test alone does not lead to
function codes(text: string, way: number): string {
  let seen = "";
  for (let pos = 0; pos < 7; pos++) {
    switch (way) {
      case 0:
        if (pos >= text.length) {
          seen += "outside,";
          break;
        }
      case 1:
        seen += text.charCodeAt(pos) + ",";
    }
  }
  return seen;
}
function deed(): string {
  return codes("abc", 0) + "|" + codes("abc", 1) + "|" + codes("abc", 2);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
