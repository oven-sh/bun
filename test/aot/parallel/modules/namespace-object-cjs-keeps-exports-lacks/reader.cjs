var files = [require("./over-json.cjs"), require("./written-out.cjs"), require("./beside-a-listed-getter.cjs"), require("./behind-the-star.cjs")];
exports.read = function () {
  return files.map(function (file) {
    return file.x;
  });
};
