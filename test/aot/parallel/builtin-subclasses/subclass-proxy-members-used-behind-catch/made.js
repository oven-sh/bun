class Below extends Proxy {
  method() {
    return 1;
  }
  static answer() {
    return 2;
  }
}
function make() {
  return new Below({ field: 1 }, {});
}
try {
  console.log(Below.answer());
} catch (error) {
  console.log("caught", error.constructor.name);
}
try {
  const made = make();
  console.log(made.field, typeof made.method);
} catch (error) {
  console.log("caught", error.constructor.name);
}
