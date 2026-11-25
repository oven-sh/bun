const outer = function self(code) {
  const reader = () => typeof self;
  eval(code);
  return typeof self + " " + reader();
};
console.log(outer("self = 5"), outer(""));
