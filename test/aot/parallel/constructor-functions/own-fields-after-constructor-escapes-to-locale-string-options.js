// F escapes through an options object passed to a built-in. An instance created earlier keeps its own fields.
function F() {
  this.b = Map;
}
const made = new F();
const options = { [F]: F };
[1].toLocaleString("en", options);
console.log(
  made.hasOwnProperty("b"),
  Object.hasOwn(made, "b"),
  "b" in made,
  Object.keys(made).join(),
  Object.keys({ ...made }).join(),
  typeof made.b,
);
