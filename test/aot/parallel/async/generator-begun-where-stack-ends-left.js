// A generator counts itself in at its first step and out when it is left. One frame begins it and leaves it, and leaving it begins the next, until the stack ends.
// A step that found room finds it again from the same frame, so every generator that has begun is also left and the count ends at zero.
// Frames of padding move the place where the stack ends. At a few places a count may stay, also in plain Bun, where the call that leaves needs more room than the call that began.
let depth = 0;
function padNarrow(k, f) {
  return k > 0 ? padNarrow(k - 1, f) + 0 : f();
}
function padWide(k, f, a, b, c, d, e, g, h) {
  return k > 0 ? padWide(k - 1, f, b, c, d, e, g, h, a) + 0 : f();
}

function leftByReturn() {
  const leave = generator => {
    generator.next();
    return generator.return(0).value;
  };
  function* counted(n) {
    depth++;
    try {
      yield n;
    } finally {
      depth--;
      leave(counted(n + 1));
    }
  }
  return () => leave(counted(0));
}

function leftByThrow() {
  const leave = generator => {
    generator.next();
    try {
      generator.throw(leave);
    } catch (error) {
      if (error !== leave) throw error;
    }
  };
  function* counted(n) {
    depth++;
    try {
      yield n;
    } finally {
      depth--;
      leave(counted(n + 1));
    }
  }
  return () => leave(counted(0));
}

function leftByASecondStep() {
  const leave = generator => {
    generator.next();
    generator.next();
  };
  function* counted(n) {
    depth++;
    yield n;
    depth--;
    leave(counted(n + 1));
  }
  return () => leave(counted(0));
}

function leftByBreak() {
  const leave = generator => {
    for (const value of generator) break;
  };
  function* counted(n) {
    depth++;
    try {
      yield n;
    } finally {
      depth--;
      leave(counted(n + 1));
    }
  }
  return () => leave(counted(0));
}

function leftByReturnFromALoop() {
  const leave = generator => {
    for (const value of generator) return value;
  };
  function* counted(n) {
    depth++;
    try {
      yield n;
    } finally {
      depth--;
      leave(counted(n + 1));
    }
  }
  return () => leave(counted(0));
}

function leftByAPattern() {
  const leave = generator => {
    const [first] = generator;
    return first;
  };
  function* counted(n) {
    depth++;
    try {
      yield n;
    } finally {
      depth--;
      leave(counted(n + 1));
    }
  }
  return () => leave(counted(0));
}

const places = 16;
for (const make of [leftByReturn, leftByThrow, leftByASecondStep, leftByBreak, leftByReturnFromALoop, leftByAPattern]) {
  const run = make();
  const outcomes = new Set();
  let stayed = 0;
  for (const pad of [padNarrow, padWide]) {
    for (let k = 0; k < places; k++) {
      depth = 0;
      try {
        pad(k, run);
        outcomes.add("answers");
      } catch (error) {
        outcomes.add(error instanceof RangeError ? "RangeError" : String(error));
      }
      if (depth) stayed++;
    }
  }
  console.log(make.name + ":", [...outcomes].join(", "), "|", stayed < places ? "what has begun is left" : "a count stays at " + stayed + " of " + 2 * places + " places");
}
// As plain Bun prints it: the run that shows so takes up to half a minute.
/* Output:
leftByReturn: RangeError | what has begun is left
leftByThrow: RangeError | what has begun is left
leftByASecondStep: RangeError | what has begun is left
leftByBreak: RangeError | what has begun is left
leftByReturnFromALoop: RangeError | what has begun is left
leftByAPattern: RangeError | what has begun is left
*/
