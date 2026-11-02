// F escapes through an options object passed to a built-in. An instance created earlier keeps its own fields.
function F() {
  this.a = 1;
  this.b = Promise;
  this.c = 2;
}
const made = new F();
const options = { [F]: F };
new ArrayBuffer(19, options);
console.log(
  made.hasOwnProperty("b"),
  Object.hasOwn(made, "b"),
  "b" in made,
  Object.keys(made).join(),
  Object.keys({ ...made }).join(),
  typeof made.b,
);
