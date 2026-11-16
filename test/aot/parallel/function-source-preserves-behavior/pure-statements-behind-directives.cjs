// A statement that does nothing is a `;` in the text of its function. Behind a directive without a semicolon that `;` ends the directive, so the string after it must not become one.
function once(a) {
  "a"
  a
  "use strict"
  return typeof this
}
function twice(a, b) {
  "a"
  a
  b
  "use strict"
  return typeof this
}
function withDefault(a = 1) {
  "a"
  a
  "use strict"
  return typeof this
}
function ended(a) {
  "a";
  a;
  "use strict";
  return typeof this;
}
for (const written of [once, twice, withDefault, ended]) {
  const made = Function("return (" + written + "\n)")();
  console.log(written.name, written.call(undefined), made.call(undefined));
}
