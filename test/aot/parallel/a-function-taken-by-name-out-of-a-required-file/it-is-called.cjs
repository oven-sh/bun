const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common");
function asks(text) {
  const refused = checkInvalidHeaderChar(text);
  return refused ? "refused" : "taken";
}
console.log(new Function("a", "return a + 1")(1));
for (const text of ["plain", "line\nfeed", "", "tab\there", "Ā"]) console.log(JSON.stringify(text), asks(text));
