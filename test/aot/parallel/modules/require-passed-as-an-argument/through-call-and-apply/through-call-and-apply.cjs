(function (load) {
  console.log(load.call(null, "./lib/one").name + load.apply(null, ["./lib/two"]).name);
})(require);
