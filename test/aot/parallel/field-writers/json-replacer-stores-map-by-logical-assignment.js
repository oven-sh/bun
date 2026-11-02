// The compiler does not know what the replacer's `value` is. The store still counts as a write to the field, and later reads see the stored value.
class C {
  a = 1;
  b;
}
const made = new C();
JSON.stringify({ made }, function (key, value) {
  if (key !== "made") return value;
  value.b ??= Map;
  return 1;
});
console.log(Object.hasOwn(made, "b"), Object.keys(made).join(), typeof made.b, made.b === Map);
