// Errors are thrown in small calls that the compiler copies into their caller, in one call after the other: upwards in one caller, downwards in the other, the two in turn.
// Each error asks which calls it is inside. What an earlier error has read about a caller is not read again for a later one.
// COUNT: decoded:InlineFrames <= 24
function check(value, bad) {
  if (value === bad) throw new RangeError("no " + value);
  return value;
}

const where = error =>
  error.stack
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().replace(/^at (\S+) .*:(\d+):(\d+)\)?$/, "$1 $2:$3"))
    .join(" < ");

function upwards(bad) {
  let sum = 0;
  try {
    sum += check(1, bad);
    sum += check(2, bad);
    sum += check(3, bad);
    sum += check(4, bad);
    sum += check(5, bad);
    sum += check(6, bad);
    sum += check(7, bad);
    sum += check(8, bad);
  } catch (error) {
    return sum + " " + error.message + " " + where(error);
  }
  return sum + " all";
}

function downwards(bad) {
  let sum = 0;
  try {
    sum += check(1, bad);
    sum += check(2, bad);
    sum += check(3, bad);
    sum += check(4, bad);
    sum += check(5, bad);
    sum += check(6, bad);
    sum += check(7, bad);
    sum += check(8, bad);
  } catch (error) {
    return sum + " " + error.message + " " + where(error);
  }
  return sum + " all";
}

for (let turn = 0; turn < 3; turn++) {
  for (let bad = 1; bad <= 9; bad++) {
    console.log(upwards(bad));
    console.log(downwards(9 - bad));
  }
}
