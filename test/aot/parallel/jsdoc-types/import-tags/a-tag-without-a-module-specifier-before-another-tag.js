/**
 * @param {Object} token @import lexical token
 * @returns {Object} node
 */
function f(token) {
  return token;
}
module.exports = { f };
console.log(module.exports.f("ok"));
