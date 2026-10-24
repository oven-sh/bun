// The same walk where the global object is in unknown hands before the formatter gets it: a store has put an object of the program on it, with a getter that the formatter runs too.
class Seven extends Set {
  get size() {
    console.log("the formatter asks for the size");
    return 7;
  }
}
globalThis.mine = new Seven();
console.log(Bun.inspect(globalThis).length > 100, Bun.inspect({ holder: globalThis }).length > 100, Bun.inspect(globalThis.mine));
