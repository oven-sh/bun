// The compiler does not know what the replacer's `value` is. The store still counts as a write to the field, and later reads see the stored value.
class C {
  b = 1;
}
const made = new C();
JSON.stringify({ made }, function (key, value) {
  if (key !== "made") return value;
  value.b = Math;
  return 1;
});
console.log(typeof made.b, made.b === Math, made.b + "");
