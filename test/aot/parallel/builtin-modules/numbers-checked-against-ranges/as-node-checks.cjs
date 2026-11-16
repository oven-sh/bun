// What lib/internal/validators.js of Node v26.3.0 answers for a number and a range: undefined where the number passes, otherwise the code of the error and what the number "must be".
const outOfRange = mustBe => `ERR_OUT_OF_RANGE ${mustBe}`;

function validateInteger(value, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number") return "ERR_INVALID_ARG_TYPE";
  if (!Number.isInteger(value)) return outOfRange("an integer");
  if (value < min || value > max) return outOfRange(`>= ${min} && <= ${max}`);
}

function validateInt32(value, min = -2147483648, max = 2147483647) {
  return validateInteger(value, min, max);
}

function validateUint32(value, positive = false) {
  return validateInteger(value, positive ? 1 : 0, 4294967295);
}

function validateNumber(value, min, max) {
  if (typeof value !== "number") return "ERR_INVALID_ARG_TYPE";
  if (
    (min != null && value < min) ||
    (max != null && value > max) ||
    ((min != null || max != null) && Number.isNaN(value))
  )
    return outOfRange(
      `${min != null ? `>= ${min}` : ""}${min != null && max != null ? " && " : ""}${max != null ? `<= ${max}` : ""}`,
    );
}

/** What a call did, in the words of the functions above. An error about another name than `name` comes from behind the check. */
function answerOf(call, name) {
  try {
    call();
  } catch (error) {
    const message = String(error?.message);
    if (error?.code === "ERR_INVALID_ARG_TYPE" && message.includes(`"${name}"`)) return "ERR_INVALID_ARG_TYPE";
    if (error?.code === "ERR_OUT_OF_RANGE") {
      const mustBe = /^The value of "(.*)" is out of range\. It must be (.*)\. Received /.exec(message);
      if (!mustBe) return `ERR_OUT_OF_RANGE in other words: ${message}`;
      if (mustBe[1] === name) return outOfRange(mustBe[2]);
    }
  }
}

// Below, at, between and above the ends of every range that follows, with what is no integer, no finite number and no number.
const numbers = [
  -Infinity, -Number.MAX_VALUE, -(2 ** 54 - 2), -(2 ** 53), Number.MIN_SAFE_INTEGER, -(2 ** 32), -(2 ** 31) - 1, -(2 ** 31), -21, -20, -2, -1.5, -1, -0.5, -Number.MIN_VALUE, -0,
  0, Number.MIN_VALUE, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 199, 200, 201, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 52, 2 ** 52 + 1, Number.MAX_SAFE_INTEGER, 2 ** 53, 2 ** 53 + 2, 2 ** 54 - 2, Number.MAX_VALUE, Infinity, NaN,
]; // prettier-ignore

const show = value => (Object.is(value, -0) ? "-0" : String(value));

module.exports = { validateInteger, validateInt32, validateUint32, validateNumber, answerOf, numbers, show };
