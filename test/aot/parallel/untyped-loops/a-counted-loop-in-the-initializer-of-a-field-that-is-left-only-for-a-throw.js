// Behind this loop the code only throws, so the way out of the loop is rare. It is still the test of the counter, the only test that the loop has, and stands at the end of a turn as in any other loop.
// The loop stands there twice: for a bound that is an integer, and for any other number.
// STATISTIC: LoopsRotated >= 2
function refuse(sum) { throw new RangeError("the sum is " + sum); }
const limit = JSON.parse("3000");
class Holder { field = (() => { let sum = 0; for (let n = 0; n < limit; n++) sum += (n & 3) * 0.25; refuse(sum); })(); }
try { new Holder(); } catch (error) { console.log(error.message); }
