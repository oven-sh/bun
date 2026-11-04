"use strict";
exports.look = function () {
  return import("./ledger.cjs").then((book) => typeof book.total + ":" + typeof book.default.total + ":" + (book.default.total + 1));
};
