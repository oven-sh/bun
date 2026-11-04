exports.twice = function (text) {
  globalThis.ran.push("pack");
  return text + text;
};
