// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// `exports = module.exports = createApplication` as the first statement, members stored through `exports` behind it, and a module in between that requires this one back.
const app = require("./app.cjs");
console.log(require("./router.cjs").saw, app().router.describe(), app().version);

// FILE: app.cjs
exports = module.exports = createApplication;
exports.version = "1";
const router = require("./router.cjs");
exports.Router = router.Router;
function createApplication() {
  return { router: new exports.Router(), version: exports.version };
}

// FILE: router.cjs
const app = require("./app.cjs");
exports.Router = class Router {
  describe() {
    return [typeof app, app.version, typeof app.Router].join();
  }
};
exports.saw = [typeof app, app.version, typeof app.Router].join();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
