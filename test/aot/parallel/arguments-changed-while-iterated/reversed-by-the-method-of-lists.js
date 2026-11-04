function turnsRound() {
  const seen = [];
  for (const value of arguments) {
    if (seen.length === 0) Array.prototype.reverse.call(arguments);
    seen.push(value);
  }
  return seen.join();
}
console.log(turnsRound("a", "b", "c"));
