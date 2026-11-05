// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// A small server framework in the form of hand-written npm packages: every module is one value, the entry has members behind it, and three files read them by name, by pattern and by call.
const framework = require("./framework/index.js");
const { Router, errors } = require("./framework/index.js");
const app = framework();
app.router.get("/", () => "home");
console.log(app.handle("GET", "/"));
console.log(app.handle("GET", "/missing"));
console.log(app.router instanceof Router, errors === framework.errors, framework.created());

// FILE: framework/errors.js
"use strict";
module.exports = createError;
module.exports.names = { 404: "NotFound" };

function createError(status) {
  return { status, name: createError.names[status] };
}

// FILE: framework/index.js
"use strict";
const Router = require("./router.js");
const errors = require("./errors.js");

let created = 1;

module.exports = framework;
module.exports.Router = Router;
module.exports.errors = errors;
module.exports.created = () => ++created - 0;

function framework() {
  const router = new Router();
  return {
    router,
    handle(method, path) {
      const handler = router.find(method, path);
      if (!handler) {
        const error = errors(404);
        return method + " " + path + " -> " + error.status + " " + error.name;
      }
      return method + " " + path + " -> " + handler();
    },
  };
}

// FILE: framework/router.js
"use strict";
module.exports = Router;

function Router() {
  this.routes = new Map();
}

for (const method of ["get", "post"]) {
  Router.prototype[method] = function (path, handler) {
    this.routes.set(method.toUpperCase() + " " + path, handler);
    return this;
  };
}

Router.prototype.find = function (method, path) {
  return this.routes.get(method + " " + path);
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
