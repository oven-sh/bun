// A method added to Buffer.prototype or Uint8Array.prototype is visible on bytes made from a literal.
// STATISTIC: ByteLiteralsEncoded = 2
function make() {
  return [typeof Buffer.from("hi").added, typeof new TextEncoder().encode("hi").added, typeof Uint8Array.fromHex("6869").added].join(" ");
}
console.log("before |", make());
try {
  Buffer.prototype.added = function () {};
  console.log("on Buffer.prototype");
} catch (error) {
  console.log("on Buffer.prototype throws", error.name);
}
console.log("then |", make());
try {
  Uint8Array.prototype.added = function () {};
  console.log("on Uint8Array.prototype");
} catch (error) {
  console.log("on Uint8Array.prototype throws", error.name);
}
console.log("then |", make());
