exports.hash = function (text) {
  var result = 0;
  for (var i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0;
  return result;
};

exports.capitalize = function (text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
};

exports.count = function (counts, word) {
  counts[word] = (counts[word] || 0) + 1;
  return counts;
};

exports.isName = function (text) {
  return typeof text === "string" && text.length > 0 && text >= "a" && text <= "z{";
};

exports.pad = function (text, width) {
  while (text.length < width) text = " " + text;
  return text;
};
