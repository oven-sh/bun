// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// A package whose export is one function, with members stored on `module.exports` behind it: two by name, which read each other, and more by a helper that gets the function as an argument and stores under computed names.
const createError = require("./create-error.cjs");
const { isHttpError, HttpError } = require("./create-error.cjs");
const missing = createError(404, "no such page");
console.log(typeof createError, createError.name, createError.length);
console.log(missing instanceof HttpError, missing instanceof createError.NotFound, isHttpError(missing), createError.isHttpError({}), missing.status, missing.message);
console.log(Object.keys(createError).join());
console.log(createError.HttpError === HttpError, createError[500] === createError.InternalServerError, createError.InternalServerError.name);

// FILE: create-error.cjs
"use strict";
module.exports = createError;
module.exports.HttpError = createHttpErrorConstructor();
module.exports.isHttpError = createIsHttpErrorFunction(module.exports.HttpError);
populateConstructorExports(module.exports, [404, 500], module.exports.HttpError);

function createError(status, message) {
  const Constructor = createError[status] || module.exports.HttpError;
  const error = new Constructor(message);
  error.status = status;
  return error;
}

function createHttpErrorConstructor() {
  function HttpError(message) {
    this.message = message;
  }
  HttpError.prototype = Object.create(Error.prototype, { constructor: { value: HttpError, writable: true, configurable: true } });
  return HttpError;
}

function createIsHttpErrorFunction(HttpError) {
  return function isHttpError(value) {
    return value instanceof HttpError;
  };
}

function populateConstructorExports(exports, codes, HttpError) {
  for (const code of codes) {
    const name = code === 404 ? "NotFound" : "InternalServerError";
    const Constructor = class extends HttpError {};
    Object.defineProperty(Constructor, "name", { value: name });
    exports[code] = Constructor;
    exports[name] = Constructor;
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
