(function (outer) {
  console.log(
    (function (inner) {
      return inner("./lib/two").name;
    })(outer) + outer("./lib/one").name,
  );
})(require);
