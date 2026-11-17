module.exports = about;
module.exports.hasBody = hasBody;
function hasBody(message) {
  return message.headers["transfer-encoding"] !== undefined || !isNaN(message.headers["content-length"]);
}
function about(message) {
  if (!hasBody(message)) return null;
  return message.headers["content-type"];
}
