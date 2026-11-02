exports.ways = {
  computedKeys: function (target, source) {
    for (var key in source) target[key] = source[key];
  },
  assign: function (target, source) {
    Object.assign(target, source);
  },
  reflect: function (target, source) {
    Object.keys(source).forEach(function (key) {
      Reflect.set(target, key, source[key]);
    });
  },
  define: function (target, source) {
    Object.keys(source).forEach(function (key) {
      Object.defineProperty(target, key, { value: source[key], writable: true, enumerable: true, configurable: true });
    });
  },
  defineAll: function (target, source) {
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
  },
  evaluatedText: function (target, source) {
    Object.keys(source).forEach(function (key) {
      eval("target." + key + " = source." + key);
    });
  },
  functionOfText: function (target, source) {
    Object.keys(source).forEach(function (key) {
      new Function("target", "value", "target." + key + " = value")(target, source[key]);
    });
  },
  entries: function (target, source) {
    for (var [key, value] of Object.entries(source)) target[key] = value;
  },
  proxy: function (target, source) {
    var proxy = new Proxy(target, {});
    for (var key in source) proxy[key] = source[key];
  },
};
