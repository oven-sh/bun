function Accepted(message) {
  this.headers = message.headers;
  this.chosen = null;
}
function Kept(headers, chunk) {
  this.headers = headers;
  this.chunk = chunk;
}
module.exports = { Accepted, Kept };
