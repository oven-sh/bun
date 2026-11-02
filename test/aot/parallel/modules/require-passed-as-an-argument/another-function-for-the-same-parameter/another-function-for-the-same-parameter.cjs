(function (use) {
  console.log(
    use(require),
    use(() => ({ name: "mine" })),
  );
})(function (load) {
  return load("./lib/one").name;
});
