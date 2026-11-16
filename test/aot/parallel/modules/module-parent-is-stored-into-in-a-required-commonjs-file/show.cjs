const { basename } = require("node:path");
module.exports = (label, object) => {
  const parent = object.parent;
  console.log(label + ":", typeof parent, parent && parent.filename ? basename(parent.filename) : String(parent));
};
