function check(condition, message) {
  console.log(condition ? "ok" : "WRONG", message);
}
check(1 + 1 === 2, "first");
check(1 + 1 === 3, "second");
