// After a program deletes Uint8Array.fromHex, the call throws.
// STATISTIC: ByteLiteralsEncoded = 0
function make() {
  return (() => { try { return String(Uint8Array.fromHex("6869")); } catch (error) { return "the call throws " + error.name; } })();
}
console.log("before |", make());
try {
  delete Uint8Array.fromHex;
  console.log("deleted");
} catch (error) {
  console.log("deleted throws", error.name);
}
console.log("then |", make());
