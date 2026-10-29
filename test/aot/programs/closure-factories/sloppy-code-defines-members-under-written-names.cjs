// Members that sloppy code defines under written names: on a literal, on exports, on the prototype of a constructor function.
var proto = {};
["get", "set", "has"].forEach(function (method) {
  proto[method] = function (key) {
    return method + ":" + key + ":" + (this === proto ? "proto" : typeof this);
  };
});
var names = ["alpha", "beta"];
for (var i = 0; i < names.length; i++)
  proto[names[i]] = (function (name) {
    return function () {
      return name;
    };
  })(names[i]);
var below = Object.create(proto);
console.log(below.get("k"), below.set("k"), proto.has("k"), below.alpha(), below.beta());
var call = proto.get;
console.log(call("free"));
["x", "y"].forEach(function (name, index) {
  exports[name] = function () {
    return name + index + this.tag;
  };
});
exports.tag = "T";
console.log(exports.x(), exports.y(), Object.keys(exports).join());
function Emitter() {}
["on", "off"].forEach(function (name) {
  Emitter.prototype[name] = function (e) {
    (this.log || (this.log = [])).push(name + e);
    return this;
  };
});
console.log(new Emitter().on("a").off("b").on("c").log.join());
["q"].forEach(function (name) {
  Object.defineProperty(Emitter.prototype, name, {
    get: function () {
      return name + this.constructor.name;
    },
    set: function (v) {
      this["_" + name] = v + name;
    },
  });
});
var em = new Emitter();
em.q = "v";
console.log(em.q, em._q);
