// Strict code rejects a function declaration behind a label, so a file with nothing else to go by is CommonJS.
held: function f() {}
function self() {
  return this === undefined;
}
console.log(self());
