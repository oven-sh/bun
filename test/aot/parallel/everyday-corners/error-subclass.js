// Error subclass: compiled answers as plain.
class E extends Error {
  constructor(m) {
    super(m);
    this.name = "E";
  }
}
try {
  throw new E("boom");
} catch (e) {
  console.log(e instanceof E, e instanceof Error, String(e), e.message, Object.keys(e).join());
}
