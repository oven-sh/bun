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
