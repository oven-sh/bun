"use strict";
module.exports = createError;
module.exports.names = { 404: "NotFound" };

function createError(status) {
  return { status, name: createError.names[status] };
}
