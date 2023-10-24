(function (){"use strict";// build2/tmp/thirdparty/depd.ts
var wrapfunction = function(fn, message) {
  if (typeof fn !== "function") {
    @throwTypeError("argument fn must be a function");
  }
  return fn;
};
var wrapproperty = function(obj, prop, message) {
  if (!obj || typeof obj !== "object" && typeof obj !== "function") {
    @throwTypeError("argument obj must be object");
  }
  var descriptor = Object.getOwnPropertyDescriptor(obj, prop);
  if (!descriptor) {
    @throwTypeError("must call property on owner object");
  }
  if (!descriptor.configurable) {
    @throwTypeError("property must be configurable");
  }
};
var $;
$ = function depd(namespace) {
  if (!namespace) {
    @throwTypeError("argument namespace is required");
  }
  function deprecate(message) {
  }
  deprecate._file = undefined;
  deprecate._ignored = true;
  deprecate._namespace = namespace;
  deprecate._traced = false;
  deprecate._warned = Object.create(null);
  deprecate.function = wrapfunction;
  deprecate.property = wrapproperty;
  return deprecate;
};
return $})
