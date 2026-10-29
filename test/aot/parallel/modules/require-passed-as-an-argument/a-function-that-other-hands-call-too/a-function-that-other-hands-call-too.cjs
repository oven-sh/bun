globalThis.later = [];
(function (use) {
  later.push(use);
  console.log(use(require));
})(function (load) {
  return load("./lib/one").name;
});
console.log(later[0](name => ({ name })));
