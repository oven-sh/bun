module.exports = function make(config) {
  var count = 0;
  var step = config.step;
  function bump() { count = count + step; return count; }
  function twice() { bump(); return bump(); }
  return { twice: twice, read: function () { return count; } };
};
module.exports.default = module.exports;
Object.defineProperty(module.exports, "__esModule", { value: !0 });
