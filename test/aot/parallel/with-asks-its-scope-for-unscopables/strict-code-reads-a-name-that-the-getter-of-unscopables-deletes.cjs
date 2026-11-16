// The getter of Symbol.unscopables deletes the name between the look for it and the read of it: strict code gets a ReferenceError, whether it reads, calls or tags.
function attempt(label, item, makeRun) {
  let asked = 0;
  const shelf = { item, get [Symbol.unscopables]() { asked++; delete shelf.item; return null; } };
  let outcome;
  try {
    outcome = `gave ${makeRun(shelf)()}`;
  } catch (error) {
    outcome = `${error.name}: ${error.message}`;
  }
  console.log(`${label}: ${outcome}, asked ${asked}, ${"item" in shelf ? "there" : "gone"}`);
}
attempt("a read", 0, shelf => {
  with (shelf) return class { static run() { return item; } }.run;
});
attempt("a call", () => 1, shelf => {
  with (shelf) return class { static run() { return item(); } }.run;
});
attempt("a tag", () => 1, shelf => {
  with (shelf) return class { static run() { return item`x`; } }.run;
});
attempt("typeof", 0, shelf => {
  with (shelf) return class { static run() { return typeof item; } }.run;
});
