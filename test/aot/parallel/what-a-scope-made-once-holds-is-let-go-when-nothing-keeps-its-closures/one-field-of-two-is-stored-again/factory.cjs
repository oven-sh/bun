module.exports = function make(config) {
  var count = 0;
  var big = null;
  function grow() { big = new Array(config.size).fill(1); }
  function touch() { if (!big) grow(); count = count + config.hook(count) + big.length; return count; }
  function ref() { return new WeakRef(big); }
  return { touch: touch, ref: ref };
};
