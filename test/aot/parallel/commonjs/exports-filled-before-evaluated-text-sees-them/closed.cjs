"use strict";
exports.early = 1;
exports.other = 2;
seal(exports);
exports.early = 3;
try {
  exports.late = 4;
} catch (error) {
  console.log(error instanceof TypeError);
}
