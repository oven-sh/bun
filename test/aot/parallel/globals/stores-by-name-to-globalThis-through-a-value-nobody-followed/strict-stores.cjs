"use strict";
const symbol = Symbol("strict shelf");

module.exports = {
  strictStore(base, value) {
    base.shelf = value;
  },
  strictStoreUnderSymbol(base, value) {
    base[symbol] = value;
  },
  readUnderStrictSymbol: base => base[symbol],
  defineUnderStrictSymbol: (base, descriptor) => Object.defineProperty(base, symbol, descriptor),
};
