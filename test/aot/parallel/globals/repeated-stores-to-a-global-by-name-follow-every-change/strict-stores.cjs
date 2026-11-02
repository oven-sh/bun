"use strict";
const symbol = Symbol("strict shelf");
const anything = process.argv.length > 50 ? { shelf: 0 } : globalThis;

function storeUnderSymbol(value) {
  anything[symbol] = value;
}

module.exports = {
  stores: {
    strictMember(value) {
      globalThis.shelf = value;
    },
    strictFree(value) {
      shelf = value;
    },
    strictMemberOfAnything(value) {
      anything.shelf = value;
    },
  },
  tellAboutSymbol(repeat) {
    console.log("strict, symbol", repeat(storeUnderSymbol, "under the symbol"), globalThis[symbol]);
    let seen = "nothing";
    Object.defineProperty(globalThis, symbol, {
      set(value) {
        seen = value;
      },
      configurable: true,
    });
    console.log("strict, symbol with a setter", repeat(storeUnderSymbol, "to the setter"), seen, globalThis[symbol]);
    Object.defineProperty(globalThis, symbol, { value: "fixed", writable: false, configurable: true });
    console.log("strict, symbol read only", repeat(storeUnderSymbol, "refused"), globalThis[symbol]);
    delete globalThis[symbol];
    console.log(
      "strict, symbol deleted",
      symbol in globalThis,
      repeat(storeUnderSymbol, "made again"),
      globalThis[symbol],
    );
  },
  tellAboutSymbolOfFrozenObject(repeat) {
    console.log("strict, symbol, frozen", repeat(storeUnderSymbol, "late"), globalThis[symbol]);
  },
};
