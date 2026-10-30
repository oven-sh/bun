// A function counts itself in, calls on inside a try and counts itself out in the finally. It also has a way out that calls nothing. When the stack ends, every frame that has counted
// itself in counts itself out: the error belongs to the try of the deepest frame that has begun, not to its caller.
// Alone: where the stack ends depends on what else ran in the process, so no joined group takes this program
let depth = 0;
let caught = 0;
function report(label, run) {
  depth = 0;
  caught = 0;
  let outcome;
  try {
    outcome = "answers " + run();
  } catch (error) {
    outcome = error instanceof RangeError ? "RangeError" : String(error);
  }
  console.log(label + ":", outcome, "| depth", depth, "| caught", caught);
}

function withAnEarlyExit(n) {
  depth++;
  try {
    if (n < 0) return 0;
    return withAnEarlyExit(n + 1) + 1;
  } finally {
    depth--;
  }
}

function withACatch(n) {
  depth++;
  try {
    if (n < 0) return 0;
    const result = withACatch(n + 1) + 1;
    depth--;
    return result;
  } catch (error) {
    depth--;
    throw error;
  }
}

function catchesAtTheEnd(n) {
  depth++;
  try {
    if (n < 0) return 0;
    const result = catchesAtTheEnd(n + 1);
    depth--;
    return result;
  } catch (error) {
    depth--;
    caught++;
    return "caught";
  }
}

const chain = { get next() { return throughAGetter(); } };
const other = { get next() { return 1; } };
function throughAGetter() {
  depth++;
  try {
    return chain.next;
  } finally {
    depth--;
  }
}

const walkers = [{ walk(n) { return throughAMethod(n + 1); } }, { walk(n) { return n; } }];
function throughAMethod(n) {
  depth++;
  try {
    return walkers[n < 0 ? 1 : 0].walk(n);
  } finally {
    depth--;
  }
}

function inALoop(n) {
  depth++;
  try {
    for (let i = 0; i < 1; i++) {
      if (n < 0) continue;
      inALoop(n + 1);
    }
  } finally {
    depth--;
  }
}

function twoFinallys(n) {
  depth += 2;
  try {
    try {
      if (n < 0) return 0;
      return twoFinallys(n + 1) + 1;
    } finally {
      depth--;
    }
  } finally {
    depth--;
  }
}

async function asynchronous(n) {
  depth++;
  try {
    if (n < 0) return 0;
    return asynchronous(n + 1);
  } finally {
    depth--;
  }
}

function* stepped(n) {
  depth++;
  try {
    if (n < 0) return 0;
    return stepped(n + 1).next().value;
  } finally {
    depth--;
  }
}

class Counted {
  constructor(n) {
    depth++;
    try {
      if (n < 0) return;
      this.next = new Counted(n + 1);
    } finally {
      depth--;
    }
  }
}

console.log(other.next, walkers[1].walk(2));
for (let round = 0; round < 3; round++) {
  report("an early exit", () => withAnEarlyExit(0));
  report("a catch that throws again", () => withACatch(0));
  report("a catch that answers", () => catchesAtTheEnd(0));
  report("a getter", () => throughAGetter());
  report("a method", () => throughAMethod(0));
  report("a loop", () => inALoop(0));
  report("two finallys", () => twoFinallys(0));
  report("a generator", () => stepped(0).next().value);
  report("a constructor", () => typeof new Counted(0));
}
depth = 0;
try {
  console.log("an async function: answers", await asynchronous(0));
} catch (error) {
  console.log("an async function:", error instanceof RangeError ? "RangeError" : String(error), "| depth", depth);
}
