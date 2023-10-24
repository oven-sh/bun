(function (){"use strict";// build3/tmp/node/trace_events.ts
var ERR_INVALID_ARG_TYPE = function(name, type, value) {
  const err = @makeTypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
};
var createTracing = function(opts) {
  if (typeof opts !== "object" || opts == null) {
    throw new ERR_INVALID_ARG_TYPE("options", "Object", opts);
  }
  return new Tracing(opts);
};
var getEnabledCategories = function() {
  return "";
};
var $;

class Tracing {
  enabled = false;
  categories = "";
}
$ = {
  createTracing,
  getEnabledCategories
};
return $})
