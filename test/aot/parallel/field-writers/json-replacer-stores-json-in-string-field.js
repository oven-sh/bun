// The compiler does not know what the replacer's `value` is. The store still counts as a write to the field, and later reads see the stored value.
class C {
  b = "x";
}
const made = new C();
JSON.stringify({ made }, function (key, value) {
  if (key !== "made") return value;
  value.b = JSON;
  return 1;
});
console.log(typeof made.b, made.b === JSON, made.b + "");
