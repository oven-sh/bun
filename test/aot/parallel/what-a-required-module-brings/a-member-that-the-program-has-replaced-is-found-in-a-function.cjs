const path = require("node:path");
path.basename = () => "replaced";
function ask() {
  return path.basename("/a/b");
}
console.log(ask(), require("node:path").basename("/a/b"));
