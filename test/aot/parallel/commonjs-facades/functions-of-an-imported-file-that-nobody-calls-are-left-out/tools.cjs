"use strict";
function make() {
  return {
    used(n) { return n + 1; },
    spareOne(n) { return n + 2; },
    spareTwo(n) { return n + 3; },
    spareThree(n) { return n + 4; },
    spareFour(n) { return n + 5; },
    spareFive(n) { return n + 6; },
    spareSix(n) { return n + 7; },
    spareSeven(n) { return n + 8; },
    spareEight(n) { return n + 9; },
    spareNine(n) { return n + 10; },
    spareTen(n) { return n + 11; },
    spareEleven(n) { return n + 12; },
    spareTwelve(n) { return n + 13; },
  };
}
module.exports = make();
