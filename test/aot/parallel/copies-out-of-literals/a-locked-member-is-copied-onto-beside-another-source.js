// Build prints: 1 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
function low() { return 0; }
function run(other) {
  try { Object.assign(Math, other, { floor: low }); } catch (error) { return error.constructor.name; }
  return "stored";
}
console.log(run({}));
/* Output:
TypeError
*/
