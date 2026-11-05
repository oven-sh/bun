// The compiler does not know what the replacer's `value` is. The store still counts as a write to the field.
function F() {
  this.a = 1;
  this.b = undefined;
}
const made = new F();
JSON.stringify({ made }, function (key, value) {
  if (key === "made") value.b = Date;
  return value;
});
console.log(
  made.hasOwnProperty("b"),
  Object.hasOwn(made, "b"),
  "b" in made,
  Object.keys(made).join(),
  Object.keys({ ...made }).join(),
  typeof made.b,
  made.b === Date,
);
