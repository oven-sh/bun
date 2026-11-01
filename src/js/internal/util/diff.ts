const { validateString } = require("internal/validators");

function validateInput(value, name) {
  if (!$isJSArray(value)) {
    validateString(value, name);
    return;
  }
  for (let i = 0; i < value.length; i++) validateString(value[i], `${name}[${i}]`);
}

// Myers' algorithm as in Node's lib/internal/assert/myers_diff.js, so that ties come out in the same order.
function myersDiff(actual, expected) {
  const actualLength = actual.length;
  const expectedLength = expected.length;
  const max = actualLength + expectedLength;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let diffLevel = 0; diffLevel <= max; diffLevel++) {
    trace.push(new Int32Array(v));
    for (let diagonalIndex = -diffLevel; diagonalIndex <= diffLevel; diagonalIndex += 2) {
      const offset = diagonalIndex + max;
      let x =
        diagonalIndex === -diffLevel || (diagonalIndex !== diffLevel && v[offset - 1] < v[offset + 1])
          ? v[offset + 1]
          : v[offset - 1] + 1;
      let y = x - diagonalIndex;
      while (x < actualLength && y < expectedLength && actual[x] === expected[y]) {
        x++;
        y++;
      }
      v[offset] = x;
      if (x >= actualLength && y >= expectedLength) return backtrack(trace, actual, expected);
    }
  }
  return [];
}

function backtrack(trace, actual, expected) {
  const max = actual.length + expected.length;
  let x = actual.length;
  let y = expected.length;
  const result: [number, string][] = [];

  for (let diffLevel = trace.length - 1; diffLevel >= 0; diffLevel--) {
    const v = trace[diffLevel];
    const diagonalIndex = x - y;
    const offset = diagonalIndex + max;
    const previousDiagonalIndex =
      diagonalIndex === -diffLevel || (diagonalIndex !== diffLevel && v[offset - 1] < v[offset + 1])
        ? diagonalIndex + 1
        : diagonalIndex - 1;
    const previousX = v[previousDiagonalIndex + max];
    const previousY = previousX - previousDiagonalIndex;

    while (x > previousX && y > previousY) {
      result.push([0, actual[x - 1]]);
      x--;
      y--;
    }
    if (diffLevel > 0) {
      if (x > previousX) result.push([1, actual[--x]]);
      else result.push([-1, expected[--y]]);
    }
  }
  return result.reverse();
}

function diff(actual, expected) {
  if (actual === expected) return [];
  validateInput(actual, "actual");
  validateInput(expected, "expected");
  return myersDiff(actual, expected);
}

export default { diff };
