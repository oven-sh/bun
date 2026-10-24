// A package whose export is one function, with members stored on `module.exports` behind it: two by name, which read each other, and more by a helper that gets the function as an argument and stores under computed names.
const createError = require("./create-error.cjs");
const { isHttpError, HttpError } = require("./create-error.cjs");
const missing = createError(404, "no such page");
console.log(typeof createError, createError.name, createError.length);
console.log(missing instanceof HttpError, missing instanceof createError.NotFound, isHttpError(missing), createError.isHttpError({}), missing.status, missing.message);
console.log(Object.keys(createError).join());
console.log(createError.HttpError === HttpError, createError[500] === createError.InternalServerError, createError.InternalServerError.name);
