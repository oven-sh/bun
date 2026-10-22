// Members of process: probes subclass. It prints what plain Bun prints.
class E extends Error {
  describe() { return this.message; }
  unused() { return 1; }
}
console.log(new E("a").describe());
