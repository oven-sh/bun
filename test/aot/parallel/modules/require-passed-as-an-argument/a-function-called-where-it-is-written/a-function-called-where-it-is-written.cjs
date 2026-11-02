(function (load, out) {
  out.push(load("./lib/one").name);
})(require, (globalThis.out = []));
console.log(out.join());
