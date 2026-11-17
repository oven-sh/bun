// An encoder with an own property named encode, or with another prototype, calls that function.
// STATISTIC: ByteLiteralsEncoded = 0
const shared = new TextEncoder();
function make() {
  return String(shared.encode("hi"));
}
console.log("before |", make());
try {
  shared.encode = input => "the own property got " + input;
  console.log("an own property");
} catch (error) {
  console.log("an own property throws", error.name);
}
console.log("then |", make());
try {
  delete shared.encode;
  console.log("deleted again");
} catch (error) {
  console.log("deleted again throws", error.name);
}
console.log("then |", make());
try {
  Object.setPrototypeOf(shared, { encode: input => "another prototype got " + input });
  console.log("another prototype");
} catch (error) {
  console.log("another prototype throws", error.name);
}
console.log("then |", make());
