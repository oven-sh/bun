exports = module.exports = createApplication;
exports.version = "1";
const router = require("./router.cjs");
exports.Router = router.Router;
function createApplication() {
  return { router: new exports.Router(), version: exports.version };
}
