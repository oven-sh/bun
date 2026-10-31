// Flags: --aot-validate
// `read(new Kind())` with `retries` on the prototype alone: the object is not made, and the read asks the site. A site that has no answer yet gives the empty value, which only the
// test behind the read looks at. The checks of a validating build took that for a value of the wrong type, and the executable stopped before its first line.
class Kind {
  a;
}
class Below extends Kind {}
Kind.prototype.retries = "text";
function read(it) {
  return it.retries;
}
const one = new Kind();
function asked() {
  return [read(one), read(new Kind()), read(new Below())].join();
}
console.log(asked());
one.retries++;
console.log(asked());
Kind.prototype.retries = "other";
console.log(asked());
delete Kind.prototype.retries;
console.log(asked());
