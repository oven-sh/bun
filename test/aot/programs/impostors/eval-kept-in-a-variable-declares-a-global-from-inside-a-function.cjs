var run = eval;
(function () {
  try {
    run("var made = 5;");
    console.log("no error", typeof made);
  } catch (error) {
    console.log(error.constructor.name);
  }
})();
