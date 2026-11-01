const path = require("node:path");
exports.where = function () {
  return [
    __filename,
    __dirname,
    module.id,
    module.filename,
    module.path,
    require.resolve("./late.cjs"),
    path.join(__dirname, "data.json"),
    require.main === module,
  ].join(" | ");
};
