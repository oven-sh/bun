// an object says 5 for its length, converts to a text of two, and has borrowed charCodeAt
function codes(text) {
  let seen = "";
  for (let pos = 0; pos < text.length; pos++) seen += text.charCodeAt(pos) + ",";
  return seen;
}
const borrower = { length: 5, charCodeAt: String.prototype.charCodeAt, toString() { return "ab"; } };
function deed() {
  return codes(borrower) + "|" + codes("ab");
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
