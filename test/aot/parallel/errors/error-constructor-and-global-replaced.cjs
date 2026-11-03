"use strict";
const original = Error;
Error.captureStackTrace = () => "replaced";
console.log(Error.captureStackTrace({}), original.captureStackTrace({}));
Error = function Other() {};
console.log(
  Error.name,
  globalThis.Error === Error,
  Error === original,
  new original("kept").message,
  new TypeError("t") instanceof original,
);
