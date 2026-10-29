console.log(
  (function (load) {
    try {
      return load("./lib/absent").name;
    } catch (error) {
      return error.code;
    }
  })(require),
);
