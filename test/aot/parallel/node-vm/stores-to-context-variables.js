const vm = require("node:vm");
const texts = [
  "var made = 42",
  "var made = seed * 21",
  "var made; made = 42",
  "function made() {}",
  "var made",
  "var made = seed; made = 2",
  "var made = seed; made = 2; made = 3",
  "var made = seed; made = 2; made = 3; made = 4",
  "var made = seed; for (var i = 0; i < 5; i++) made = i",
  "var made = 0 * seed; function bump() { made++ } bump(); bump(); bump()",
  "made = 42",
  "this.made = 42",
  "let made = seed",
  "var made = seed; delete this.made",
];
for (const text of texts) {
  const sandbox = { seed: 2 };
  vm.createContext(sandbox);
  vm.runInContext(text, sandbox);
  console.log(
    text +
      ": " +
      (typeof sandbox.made === "function" ? "function" : String(sandbox.made)) +
      " | " +
      Object.keys(sandbox).join() +
      " | " +
      Object.getOwnPropertyNames(sandbox).join(),
  );
}

/* Output:
var made = 42: 42 | seed,made | seed,made
var made = seed * 21: 42 | seed,made | seed,made
var made; made = 42: 42 | seed,made | seed,made
function made() {}: function | seed,made | seed,made
var made: undefined | seed | seed
var made = seed; made = 2: 2 | seed,made | seed,made
var made = seed; made = 2; made = 3: 3 | seed,made | seed,made
var made = seed; made = 2; made = 3; made = 4: 4 | seed,made | seed,made
var made = seed; for (var i = 0; i < 5; i++) made = i: 4 | seed,made,i | seed,made,i
var made = 0 * seed; function bump() { made++ } bump(); bump(); bump(): 3 | seed,bump,made | seed,bump,made
made = 42: 42 | seed,made | seed,made
this.made = 42: 42 | seed,made | seed,made
let made = seed: undefined | seed | seed
var made = seed; delete this.made: undefined | seed | seed
*/
