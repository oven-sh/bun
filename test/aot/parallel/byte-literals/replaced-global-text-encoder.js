// A program that stores another class into globalThis.TextEncoder constructs that class.
// STATISTIC: ByteLiteralsEncoded = 0
function make() {
  return String(new TextEncoder().encode("hi"));
}
console.log("before |", make());
try {
  globalThis.TextEncoder = class { encode(input) { return "the replacement got " + input; } };
  console.log("stored");
} catch (error) {
  console.log("stored throws", error.name);
}
console.log("then |", make());
