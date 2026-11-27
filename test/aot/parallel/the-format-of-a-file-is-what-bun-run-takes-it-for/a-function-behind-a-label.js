// Strict code rejects a function declaration behind a label, so a file with nothing else to go by is CommonJS. There the function is declared above the label too.
console.log(typeof f, f());
held: function f() {
  return this === undefined;
}
