const { validateString } = require("internal/validators");

function validateInput(value, name) {
  if (!$isJSArray(value)) {
    validateString(value, name);
    return;
  }
  for (let i = 0; i < value.length; i++) validateString(value[i], `${name}[${i}]`);
}

// Myers' algorithm as in Node's lib/internal/assert/myers_diff.js, so that ties come out in the same order.
// Node copies every diagonal at every level. A level here leaves out diagonals that no shortest path can still use:
// `trace[level][i]` is the furthest x on diagonal `lowest[level] + 2 * i` before `level` is searched.
function myersDiff(actual, expected) {
  const actualLength = actual.length;
  const expectedLength = expected.length;
  let previous = new Int32Array(1);
  let previousLow = 1;
  const trace = [previous];
  const lowest = [previousLow];
  let low = 0;
  let high = 0;

  while (true) {
    const current = new Int32Array((high - low) / 2 + 1);
    let nextLow = low - 1;
    let nextHigh = high + 1;
    const previousLength = previous.length;
    let above = (low + 1 - previousLow) / 2;
    let below = above > 0 ? previous[above - 1] : -1;

    for (let i = 0, diagonalIndex = low; diagonalIndex <= high; i++, above++, diagonalIndex += 2) {
      const next = above < previousLength ? previous[above] : -1;
      let x = below < next ? next : below + 1;
      below = next;
      let y = x - diagonalIndex;
      while (x < actualLength && y < expectedLength && actual[x] === expected[y]) {
        x++;
        y++;
      }
      current[i] = x;
      // After a diagonal has used up an input, no shortest path continues along it or beyond it.
      if (x === actualLength) {
        if (y === expectedLength) return backtrack(trace, lowest, actual, expected);
        nextHigh = diagonalIndex - 1;
        // The rest of `current` stays 0, and no later level reads it.
        break;
      }
      if (y === expectedLength) nextLow = diagonalIndex + 1;
    }

    trace.push(current);
    lowest.push(low);
    previous = current;
    previousLow = low;
    low = nextLow;
    high = nextHigh;
  }
}

function backtrack(trace: Int32Array[], lowest: number[], actual, expected) {
  let x = actual.length;
  let y = expected.length;
  const result: [number, string][] = [];

  for (let diffLevel = trace.length - 1; diffLevel >= 0; diffLevel--) {
    const level = trace[diffLevel];
    const low = lowest[diffLevel];
    let index = (x - y + 1 - low) / 2;
    if (index === level.length || (index > 0 && level[index - 1] >= level[index])) index--;
    const previousX = level[index];
    const previousY = previousX - (low + 2 * index);

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
