var fs = require("fs");
exports.FILES = [require.resolve("../lib/nodes.js"), require.resolve("../lib/print.js")];
new Function("exports", function () {
  var code = exports.FILES.map(function (file) {
    return fs.readFileSync(file, "utf8");
  });
  code.push("exports.describe = " + describe.toString());
  return code.join("\n\n");
}())(exports);
function describe() {
  return "nodes";
}
