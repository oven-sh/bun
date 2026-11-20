// What is answered to a number that a range holds or does not hold: "inside", or the words of the error that say what the number has to be.
const numbers = [
  NaN, Infinity, -Infinity, 0, -0, 1, -1, 2, -2, 3, 5, 6, 7, -7, 10, 11, 64, 99.5, 0.25, -0.25, 1.5, -1.5, 100, 255, 256, 1000, 65535, 65536,
  2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1, 2 ** 49, 2 ** 50, 2 ** 51, 2 ** 53, -(2 ** 53) + 1, -(2 ** 53), 1e300,
]; // prettier-ignore
const show = number => (Object.is(number, -0) ? "-0" : String(number));

// An end of a range: the sign it is told by, where it lies, and the way that leads out of the range there. An end that nobody gives is none.
const ends = (least, most) => [[">=", least, -1], ["<=", most, 1]].filter(([, place]) => place !== undefined);
const words = row => row.map(([sign, place]) => `${sign} ${place}`).join(" && ");
const outside = (number, row) => row.some(([, place, way]) => (number - place) * way > 0);
const ranged = (number, row, left = outside(number, row)) => (left ? words(row) : "inside");
const whole = (number, least, most) => (Number.isInteger(number) ? ranged(number, ends(least, most)) : "an integer");

module.exports = {
  numbers,
  show,
  answerOf(call, name) {
    try {
      call();
      return "inside";
    } catch (error) {
      const said = /^The value of "(.+)" is out of range\. It must be (.+)\. Received /s.exec(error.message);
      const known = error instanceof RangeError && error.code === "ERR_OUT_OF_RANGE" && said && said[1] === name;
      return known ? said[2] : `${error.name} ${error.code} ${error.message}`;
    }
  },
  validateInteger: (number, least = Number.MIN_SAFE_INTEGER, most = Number.MAX_SAFE_INTEGER) => whole(number, least, most),
  validateInt32: (number, least = -(2 ** 31), most = 2 ** 31 - 1) => whole(number, least, most),
  validateUint32: (number, positive) => whole(number, positive ? 1 : 0, 2 ** 32 - 1),
  // What is no number at all lies outside of every range that has an end.
  validateNumber(number, least, most) {
    const row = ends(least, most);
    return ranged(number, row, Number.isNaN(number) ? row.length > 0 : outside(number, row));
  },
};
