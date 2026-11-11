const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common");
function asks(text) {
  const refused = checkInvalidHeaderChar(text);
  return refused ? "refused" : "taken";
}
console.log(asks("plain"), asks("line\nfeed"));
const stores = new Function("ask", "ask('node:_http_common')._checkInvalidHeaderChar = function () { return 'another'; }; return 1");
console.log(stores(require));
console.log(asks("plain"), asks("line\nfeed"), require("node:_http_common")._checkInvalidHeaderChar("plain"));
