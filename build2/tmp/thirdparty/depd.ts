var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/thirdparty/depd.js


$ = function depd(namespace) {
  if (!namespace) {
    __intrinsic__throwTypeError("argument namespace is required");
  }
  function deprecate(message) {}
  deprecate._file = void 0;
  deprecate._ignored = true;
  deprecate._namespace = namespace;
  deprecate._traced = false;
  deprecate._warned = /* @__PURE__ */ Object.create(null);
  deprecate.function = wrapfunction;
  deprecate.property = wrapproperty;
  return deprecate;
}
function wrapfunction(fn, message) {
  if (typeof fn !== "function") {
    __intrinsic__throwTypeError("argument fn must be a function");
  }
  return fn;
}
function wrapproperty(obj, prop, message) {
  if (!obj || (typeof obj !== "object" && typeof obj !== "function")) {
    __intrinsic__throwTypeError("argument obj must be object");
  }
  var descriptor = Object.getOwnPropertyDescriptor(obj, prop);
  if (!descriptor) {
    __intrinsic__throwTypeError("must call property on owner object");
  }
  if (!descriptor.configurable) {
    __intrinsic__throwTypeError("property must be configurable");
  }
}
$$EXPORT$$($).$$EXPORT_END$$;
