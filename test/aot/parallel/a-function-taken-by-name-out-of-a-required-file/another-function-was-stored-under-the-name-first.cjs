const stores = new Function("ask", "ask('node:_http_common')._checkInvalidHeaderChar = function (text) { return 'another ' + text; }; return 1");
console.log(stores(require));
const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common");
function asks(text) {
  const answer = checkInvalidHeaderChar(text);
  return answer ? "answered " + answer : "nothing";
}
for (const text of ["plain", "line\nfeed"]) console.log(JSON.stringify(text), asks(text));
