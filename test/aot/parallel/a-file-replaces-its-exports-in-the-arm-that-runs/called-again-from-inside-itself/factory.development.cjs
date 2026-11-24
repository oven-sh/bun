module.exports = function make(config) {
  var count = 0;
  var step = config.step;
  var inner = config.depth ? make({ step: step + 1, depth: config.depth - 1 }) : null;
  function bump() { count = count + step; return count; }
  function twice() { bump(); return bump(); }
  return { twice: twice, inner: inner, read: function () { return count; } };
};
