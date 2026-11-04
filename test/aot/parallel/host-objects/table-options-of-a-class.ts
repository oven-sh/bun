// The options of Bun.inspect.table may stand second, and native code alone reads them: here a getter of a class.
class Options {
  get colors() {
    return false;
  }
}
console.log(Bun.inspect.table([{ a: 1 }], new Options()));
