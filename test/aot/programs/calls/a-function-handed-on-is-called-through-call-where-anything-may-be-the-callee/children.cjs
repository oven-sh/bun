"use strict";
function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
  var type = typeof children;
  if ("undefined" === type || "boolean" === type) children = null;
  var invokeCallback = !1;
  if (null === children) invokeCallback = !0;
  else
    switch (type) {
      case "bigint":
      case "string":
      case "number":
        invokeCallback = !0;
        break;
      case "object":
        invokeCallback = !Array.isArray(children);
    }
  if (invokeCallback) {
    callback = callback(children);
    if (Array.isArray(callback)) mapIntoArray(callback, array, "", "", function (c) { return c; });
    else if (null != callback) array.push(callback);
    return 1;
  }
  invokeCallback = 0;
  for (var i = 0; i < children.length; i++) invokeCallback += mapIntoArray(children[i], array, escapedPrefix, nameSoFar + i, callback);
  return invokeCallback;
}
function mapChildren(children, func, context) {
  if (null == children) return children;
  var result = [], count = 0;
  mapIntoArray(children, result, "", "", function (child) {
    return func.call(context, child, count++);
  });
  return result;
}
exports.Children = {
  map: mapChildren,
  forEach: function (children, forEachFunc, forEachContext) {
    mapChildren(children, function () { forEachFunc.apply(this, arguments); }, forEachContext);
  },
  count: function (children) {
    var n = 0;
    mapChildren(children, function () { n++; });
    return n;
  },
  toArray: function (children) {
    return mapChildren(children, function (child) { return child; }) || [];
  },
};
