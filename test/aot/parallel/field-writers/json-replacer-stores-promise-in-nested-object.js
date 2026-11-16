// The compiler does not know what the replacer's `value` is. The store still counts as a write to the field, and later reads see the stored value.
const made = { inner: { b: null } };
JSON.stringify({ made }, function (key, value) {
  if (key !== "made") return value;
  value.inner.b = Promise;
  return 1;
});
console.log(typeof made.inner.b, made.inner.b === Promise, Object.keys(made.inner).join());
