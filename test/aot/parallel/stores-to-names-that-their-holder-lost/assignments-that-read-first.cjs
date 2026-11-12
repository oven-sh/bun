const outcomes = [];
function attempt(label, shelf, makeRun) {
  let outcome;
  try {
    outcome = `gave ${makeRun(shelf)()}`;
  } catch (error) {
    outcome = error.name;
  }
  outcomes.push(`${label}: ${outcome}, ${"count" in shelf ? shelf.count : "gone"}`);
}
attempt("+=", { count: 1 }, shelf => {
  with (shelf) return class { static run() { return (count += (delete shelf.count, 2)); } }.run;
});
attempt("??=", { count: null }, shelf => {
  with (shelf) return class { static run() { return (count ??= (delete shelf.count, 2)); } }.run;
});
attempt("||=", { count: 0 }, shelf => {
  with (shelf) return class { static run() { return (count ||= (delete shelf.count, 2)); } }.run;
});
attempt("&&=", { count: 1 }, shelf => {
  with (shelf) return class { static run() { return (count &&= (delete shelf.count, 2)); } }.run;
});
attempt("&&= that stores nothing", { count: 0 }, shelf => {
  with (shelf) return class { static run() { return (count &&= (delete shelf.count, 2)); } }.run;
});
const leaves = { get count() { delete this.count; return 5; }, configurable: true };
attempt("++ over a getter that leaves", leaves, shelf => {
  with (shelf) return class { static run() { return count++; } }.run;
});
const leavesToo = { get count() { delete this.count; return 5; } };
attempt("-- in front, over a getter that leaves", leavesToo, shelf => {
  with (shelf) return class { static run() { return --count; } }.run;
});
const sloppy = { get count() { delete this.count; return 5; } };
attempt("++ in sloppy code", sloppy, shelf => {
  with (shelf) return function () { return count++; };
});
console.log(outcomes.join("\n"));
