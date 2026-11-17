const stores = new Function("ask", "ask('node:_http_common')._checkInvalidHeaderChar = 7; return 1");
console.log(stores(require));
const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common");
function asks(text) {
  const refused = checkInvalidHeaderChar(text);
  return refused ? "refused" : "taken";
}
try {
  console.log(asks("plain"));
} catch (error) {
  console.log(error instanceof TypeError, error.message);
}
