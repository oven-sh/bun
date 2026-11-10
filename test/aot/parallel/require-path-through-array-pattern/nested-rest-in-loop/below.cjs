function idle() {}
for (const [...[name]] of [["./part.cjs"], ["./other.cjs"]]) {
  console.log(name);
  require(name);
}
